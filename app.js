'use strict';
/* =====================================================================
   OmniConvert — client-side any-to-any file conversion engine
   Everything runs in the browser: parsing, rendering, merging, editing.
   ===================================================================== */

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* Keep conversions running at full speed in background tabs: browsers throttle
   setTimeout in hidden tabs (down to 1/minute), which stalls libraries that
   chunk work via setTimeout(0) (JSZip, mammoth). MessageChannel tasks are
   exempt, so route zero-delay timers through one. */
(() => {
  const mc = new MessageChannel();
  const q = [];
  mc.port1.onmessage = () => { const fn = q.shift(); if (fn) try { fn(); } catch (e) { console.error(e); } };
  const orig = window.setTimeout;
  window.setTimeout = function (fn, ms, ...args) {
    if ((!ms || ms <= 0) && typeof fn === 'function' && !args.length) {
      q.push(fn);
      mc.port2.postMessage(0);
      return -1;
    }
    return orig(fn, ms, ...args);
  };
})();

/* ================= 1. Format registry ================= */

const FORMATS = {
  pdf:  { label: 'PDF',          kind: 'pdf',   ext: 'pdf',  mime: 'application/pdf', group: 'Documents', ico: '📕' },
  docx: { label: 'Word (DOCX)',  kind: 'doc',   ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', group: 'Documents', ico: '📘' },
  txt:  { label: 'Plain text',   kind: 'doc',   ext: 'txt',  mime: 'text/plain', group: 'Documents', ico: '📄' },
  md:   { label: 'Markdown',     kind: 'doc',   ext: 'md',   mime: 'text/markdown', group: 'Documents', ico: '📝' },
  html: { label: 'HTML',         kind: 'doc',   ext: 'html', mime: 'text/html', group: 'Documents', ico: '🌐' },
  rtf:  { label: 'Rich Text (RTF)', kind: 'doc', ext: 'rtf', mime: 'application/rtf', group: 'Documents', ico: '📃' },
  csv:  { label: 'CSV',          kind: 'table', ext: 'csv',  mime: 'text/csv', group: 'Data', ico: '📊' },
  tsv:  { label: 'TSV',          kind: 'table', ext: 'tsv',  mime: 'text/tab-separated-values', group: 'Data', ico: '📊' },
  json: { label: 'JSON',         kind: 'table', ext: 'json', mime: 'application/json', group: 'Data', ico: '🧾' },
  xml:  { label: 'XML',          kind: 'table', ext: 'xml',  mime: 'application/xml', group: 'Data', ico: '🧾' },
  xlsx: { label: 'Excel (XLSX)', kind: 'table', ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', group: 'Data', ico: '📗' },
  png:  { label: 'PNG',          kind: 'image', ext: 'png',  mime: 'image/png', group: 'Images', ico: '🖼️' },
  jpeg: { label: 'JPEG',         kind: 'image', ext: 'jpg',  mime: 'image/jpeg', group: 'Images', ico: '🖼️' },
  webp: { label: 'WebP',         kind: 'image', ext: 'webp', mime: 'image/webp', group: 'Images', ico: '🖼️' },
  bmp:  { label: 'BMP',          kind: 'image', ext: 'bmp',  mime: 'image/bmp', group: 'Images', ico: '🖼️' },
  gif:  { label: 'GIF',          kind: 'image', ext: 'gif',  mime: 'image/gif', group: 'Images', ico: '🎞️' },
  svg:  { label: 'SVG',          kind: 'image', ext: 'svg',  mime: 'image/svg+xml', group: 'Images', ico: '✒️' },
  pptx: { label: 'PowerPoint (PPTX)', kind: 'doc', ext: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', group: 'Documents', ico: '📙' },
  tex:  { label: 'LaTeX',        kind: 'doc',   ext: 'tex',  mime: 'application/x-tex', group: 'Documents', ico: '📜' },
  epub: { label: 'ePub',         kind: 'doc',   ext: 'epub', mime: 'application/epub+zip', group: 'Documents', ico: '📚' },
  py:   { label: 'Python code',  kind: 'code',  ext: 'py',   mime: 'text/x-python', group: 'Code & Science', ico: '🐍' },
  mcode:{ label: 'MATLAB code',  kind: 'code',  ext: 'm',    mime: 'text/plain', group: 'Code & Science', ico: '🧮' },
  bib:  { label: 'BibTeX (.bib)', kind: 'ref',  ext: 'bib',  mime: 'text/plain', group: 'Code & Science', ico: '🔖' },
  arff: { label: 'ARFF (Weka)',  kind: 'table', ext: 'arff', mime: 'text/plain', group: 'Data', ico: '🧪' },
  mlab: { label: 'MATLAB data (.m)', kind: 'table', ext: 'm', mime: 'text/plain', group: 'Data', ico: '📈' },
  mp3:  { label: 'MP3',          kind: 'audio', ext: 'mp3',  mime: 'audio/mpeg', group: 'Audio', ico: '🎵' },
  wav:  { label: 'WAV',          kind: 'audio', ext: 'wav',  mime: 'audio/wav', group: 'Audio', ico: '🎵' },
  ogg:  { label: 'OGG',          kind: 'audio', ext: 'ogg',  mime: 'audio/ogg', group: 'Audio', ico: '🎵', inOnly: true },
  m4a:  { label: 'M4A',          kind: 'audio', ext: 'm4a',  mime: 'audio/mp4', group: 'Audio', ico: '🎵', inOnly: true },
  mp4:  { label: 'MP4 video',    kind: 'video', ext: 'mp4',  mime: 'video/mp4', group: 'Video', ico: '🎬' },
  webm: { label: 'WebM video',   kind: 'video', ext: 'webm', mime: 'video/webm', group: 'Video', ico: '🎬' },
  zip:  { label: 'ZIP (LaTeX + media)', kind: 'archive', ext: 'zip', mime: 'application/zip', group: 'Documents', ico: '📦', inOnly: true },
  enc:  { label: '🔐 Encrypted (AES-256)', kind: 'sec', ext: 'enc', mime: 'application/octet-stream', group: 'Security', ico: '🔐' },
  auto: { label: '🔓 Decrypt to original', kind: 'sec', ext: 'bin', mime: 'application/octet-stream', group: 'Security', ico: '🔓', inOnly: true },
};

const EXT_MAP = {
  pdf: 'pdf', docx: 'docx', txt: 'txt', text: 'txt', log: 'txt', md: 'md', markdown: 'md',
  html: 'html', htm: 'html', rtf: 'rtf', csv: 'csv', tsv: 'tsv', json: 'json', xml: 'xml',
  xlsx: 'xlsx', xls: 'xlsx', ods: 'xlsx', png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp',
  bmp: 'bmp', gif: 'gif', svg: 'svg', mp3: 'mp3', wav: 'wav', ogg: 'ogg', oga: 'ogg',
  m4a: 'm4a', mp4: 'mp4', mov: 'mp4', avi: 'mp4', webm: 'webm',
  pptx: 'pptx', tex: 'tex', latex: 'tex', epub: 'epub', enc: 'enc',
  py: 'py', m: 'mcode', arff: 'arff', bib: 'bib',
};

const DOC_OUT   = ['txt', 'md', 'html', 'rtf', 'docx', 'pdf', 'pptx', 'tex', 'epub'];
const TABLE_OUT = ['csv', 'tsv', 'json', 'xml', 'xlsx', 'html', 'md', 'txt', 'docx', 'pdf', 'rtf', 'pptx', 'tex', 'epub'];
const IMG_OUT   = ['png', 'jpeg', 'webp', 'bmp', 'gif', 'svg', 'pdf', 'docx', 'xlsx', 'csv', 'tsv', 'json', 'xml', 'txt', 'md', 'html', 'rtf'];

function targetsFor(fmt) {
  const k = FORMATS[fmt].kind;
  if (fmt === 'enc') return ['auto'];
  let out =
    k === 'doc'   ? DOC_OUT :
    k === 'table' ? TABLE_OUT :
    k === 'image' ? IMG_OUT :
    k === 'pdf'   ? ['docx', 'txt', 'md', 'html', 'rtf', 'pptx', 'tex', 'epub', 'csv', 'tsv', 'xlsx', 'json', 'xml', 'png', 'jpeg', 'webp', 'bmp', 'gif'] :
    k === 'audio' ? ['wav', 'mp3'] :
    k === 'video' ? ['mp4', 'webm', 'gif', 'png', 'jpeg', 'wav', 'mp3'] :
    k === 'code'  ? ['tex', 'html', 'pdf', 'docx', 'md', 'rtf', 'txt'] :
    k === 'ref'   ? ['txt', 'md', 'html', 'docx', 'pdf', 'json', 'csv', 'xlsx'] : [];
  if (fmt === 'txt') out = out.concat(['csv', 'tsv', 'xlsx', 'json', 'xml', 'arff', 'mlab', 'bib']);
  return out.filter(t => t !== fmt && (!FORMATS[t].inOnly || (k === 'video' && FORMATS[t].kind === 'video')))
    .concat(k === 'sec' ? [] : ['enc']);
}

/* Count all conversion paths (direct + chained up to 4 steps). */
function countCombos() {
  const ids = Object.keys(FORMATS);
  const idx = Object.fromEntries(ids.map((f, i) => [f, i]));
  const n = ids.length;
  let A = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const f of ids) for (const t of targetsFor(f)) A[idx[f]][idx[t]] = 1;
  const mul = (X, Y) => X.map((row, i) =>
    row.map((_, j) => row.reduce((s, v, k) => s + v * Y[k][j], 0)));
  let total = 0, P = A;
  for (let len = 1; len <= 4; len++) {
    total += P.flat().reduce((a, b) => a + b, 0);
    P = mul(P, A);
  }
  return total;
}

/* ================= 2. Utilities ================= */

/* strip C0 control chars (PDF font CMaps can map glyphs onto them — they are
   invalid in XML and break LaTeX with "Unicode character ^^R" errors) */
const stripCtl = s => String(s).replace(/[ --]/g, '');

const esc = s => stripCtl(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtSize = b =>
  b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' :
  b > 1024 ? (b / 1024).toFixed(1) + ' KB' : b + ' B';

const baseName = n => n.replace(/\.[^.]+$/, '');

/* jsPDF's standard fonts only cover WinAnsi (Latin-1). A character outside it —
   Unicode hyphen U+2010, arrows, Greek… — silently corrupts the ENTIRE text run
   into a mangled 2-byte encoding (NUL between every glyph), so content becomes
   unreadable/unextractable. Transliterate to safe ASCII before drawing. */
const PDF_TXT_MAP = {
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-',
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'",
  '“': '"', '”': '"', '„': '"', '″': '"',
  '•': '•', '‣': '-', '●': '•', '▪': '•', '⁃': '-',
  '…': '...', ' ': ' ', '​': '', ' ': ' ', ' ': ' ',
  '→': '->', '←': '<-', '⇒': '=>', '↔': '<->',
  '×': 'x', '÷': '/', '≠': '!=', '≤': '<=', '≥': '>=', '≈': '~',
  'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon',
  'θ': 'theta', 'λ': 'lambda', 'μ': 'mu', 'π': 'pi', 'σ': 'sigma',
  'φ': 'phi', 'ω': 'omega', 'Δ': 'Delta', 'Σ': 'Sigma', 'Ω': 'Omega', 'Π': 'Pi',
};
function pdfText(s) {
  // keep WinAnsi range (incl. accented Latin 0xA0-0xFF, which jsPDF renders);
  // map known Unicode punctuation to ASCII; replace anything else with '?'
  return stripCtl(s).replace(/[^\x00-\xFF]/g, ch =>
    PDF_TXT_MAP[ch] !== undefined ? PDF_TXT_MAP[ch] : '?');
}

function outName(input, fmt, suffix = '') {
  return `${baseName(input)}${suffix}.${FORMATS[fmt].ext}`;
}

function download(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file.blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

let toastTimer;
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 4200);
}

function detectFmt(name, mime = '') {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (EXT_MAP[ext]) return EXT_MAP[ext];
  if (mime.startsWith('image/')) return EXT_MAP[mime.split('/')[1]] || 'png';
  if (mime.startsWith('audio/')) return 'mp3';
  if (mime.startsWith('video/')) return 'mp4';
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('json')) return 'json';
  if (mime.includes('html')) return 'html';
  if (mime.includes('xml')) return 'xml';
  if (mime.includes('csv')) return 'csv';
  if (mime.startsWith('text/')) return 'txt';
  return null;
}

/* pdf.js worker (vendored, same-origin — works on the web and inside the extension) */
let pdfjsReady;
function ensurePdfjs() {
  if (!pdfjsReady) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    pdfjsReady = Promise.resolve();
  }
  return pdfjsReady;
}

async function getPdf(file) {
  await ensurePdfjs();
  const data = await file.blob.arrayBuffer();
  return pdfjsLib.getDocument({ data }).promise;
}

/* ================= 3. Parsers → intermediate representations ================= */

function textToHtml(text) {
  return text.split(/\n{2,}/).map(p =>
    `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n');
}

function stripHtml(html) {
  const d = new DOMParser().parseFromString(html, 'text/html');
  d.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,tr,br').forEach(el => el.append('\n'));
  return d.body.textContent.replace(/\n{3,}/g, '\n\n').trim();
}

function rtfToText(rtf) {
  return rtf
    .replace(/\{\\(?:fonttbl|colortbl|stylesheet|info|\*)[^{}]*(?:\{[^{}]*\})*[^{}]*\}/g, '')
    .replace(/\\'([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u(-?\d+)\??/g, (m, n) => String.fromCharCode(((+n) + 65536) % 65536))
    .replace(/\\par[d]?\b/g, '\n')
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/* PDF → { html, text }: font-aware extraction — rebuilds lines from glyph
   positions, then uses font sizes/weights to restore headings, bold text and
   centered lines. Scanned PDFs (no text layer) automatically fall back to OCR. */
async function pdfToDoc(file) {
  const pdf = await getPdf(file);
  let html = '', text = '', totalChars = 0;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const vpw = page.getViewport({ scale: 1 }).width;
    const lines = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = it.transform[5];
      const size = Math.hypot(it.transform[2], it.transform[3]) || 12;
      const fname = ((tc.styles && tc.styles[it.fontName] && tc.styles[it.fontName].fontFamily) || '') + ' ' + (it.fontName || '');
      let line = lines.find(l => Math.abs(l.y - y) <= 2.5);
      if (!line) { line = { y, items: [], size: 0, bold: false }; lines.push(line); }
      line.items.push({ x: it.transform[4], w: it.width || 0, s: stripCtl(it.str) });
      line.size = Math.max(line.size, size);
      if (/bold|black|heavy/i.test(fname)) line.bold = true;
    }
    lines.sort((a, b) => b.y - a.y);
    const joined = lines.map(l => {
      l.items.sort((a, b) => a.x - b.x);
      let out = '', end = null;
      for (const it of l.items) {
        if (end !== null && it.x - end > 1.5) out += ' ';
        out += it.s;
        end = it.x + it.w;
      }
      const last = l.items[l.items.length - 1];
      return { y: l.y, s: out.replace(/\s+/g, ' ').trim(), size: l.size, bold: l.bold,
               x0: l.items[0].x, x1: last.x + last.w };
    }).filter(l => l.s);

    // headings from font-size outliers, centering from geometry
    const sizes = joined.map(l => l.size).sort((a, b) => a - b);
    const body = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 12;
    const tagOf = l => l.size > body * 1.6 ? 'h1' : l.size > body * 1.3 ? 'h2' : l.size > body * 1.15 ? 'h3' : 'p';
    const centered = l => vpw > 0 && Math.abs((l.x0 + l.x1) / 2 - vpw / 2) < vpw * 0.06 && (l.x1 - l.x0) < vpw * 0.7;

    // paragraph detection: a vertical gap much larger than the median line gap
    const gaps = [];
    for (let i = 1; i < joined.length; i++) gaps.push(joined[i - 1].y - joined[i].y);
    const sortedG = [...gaps].sort((a, b) => a - b);
    const median = sortedG.length ? sortedG[Math.floor(sortedG.length / 2)] : 14;
    const thresh = Math.max(median * 1.7, 6);

    const blocks = [];
    let cur = null;
    joined.forEach((l, i) => {
      const tag = tagOf(l), cent = centered(l);
      if (!cur || (i > 0 && gaps[i - 1] > thresh) || tag !== cur.tag || cent !== cur.cent || tag !== 'p')
        { cur = { tag, cent, bold: l.bold, parts: [] }; blocks.push(cur); }
      cur.bold = cur.bold && l.bold;
      cur.parts.push(l.s);
    });
    for (const b of blocks) {
      const t = b.parts.join(' ');
      const inner = (b.tag === 'p' && b.bold) ? `<strong>${esc(t)}</strong>` : esc(t);
      html += `<${b.tag}${b.cent ? ' style="text-align:center"' : ''}>${inner}</${b.tag}>\n`;
      text += t + '\n';
      totalChars += t.length;
    }
    text += '\n';
  }
  // scanned PDF (little or no text layer) → OCR every page
  if (totalChars < pdf.numPages * 20) {
    try {
      const canvases = await pdfToCanvases(file, 20);
      let oHtml = '', oText = '';
      for (const c of canvases) {
        const t = await ocrCanvas(c);
        if (t) { oHtml += textToHtml(t) + '\n'; oText += t + '\n\n'; }
      }
      if (oText.trim().length > totalChars)
        return { html: oHtml.trim(), text: oText.trim(), ocr: true };
    } catch (e) { console.warn('OCR fallback unavailable:', e); }
  }
  return { html: html.trim(), text: text.trim() };
}

/* any table-format file → array-of-arrays */
async function toTable(file) {
  if (file.fmt === 'json') {
    const j = JSON.parse(await file.blob.text());
    if (Array.isArray(j)) {
      if (j.every(r => Array.isArray(r))) return j;
      if (j.every(r => r && typeof r === 'object')) {
        const headers = [...new Set(j.flatMap(o => Object.keys(o)))];
        return [headers, ...j.map(o => headers.map(h => {
          const v = o[h];
          return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v;
        }))];
      }
      return [['value'], ...j.map(v => [v])];
    }
    const rows = [['key', 'value']];
    (function flat(obj, path) {
      for (const [k, v] of Object.entries(obj)) {
        const p = path ? `${path}.${k}` : k;
        if (v && typeof v === 'object') flat(v, p);
        else rows.push([p, v == null ? '' : v]);
      }
    })(j, '');
    return rows;
  }
  if (file.fmt === 'xml') {
    const doc = new DOMParser().parseFromString(await file.blob.text(), 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('Invalid XML');
    const root = doc.documentElement;
    const rowEls = [...root.children].filter(c => c.children.length);
    if (rowEls.length) {
      const headers = [...new Set(rowEls.flatMap(r => [...r.children].map(c => c.tagName)))];
      return [headers, ...rowEls.map(r => headers.map(h => {
        const el = [...r.children].find(c => c.tagName === h);
        return el ? el.textContent.trim() : '';
      }))];
    }
    return [['element', 'value'], ...[...root.children].map(c => [c.tagName, c.textContent.trim()])];
  }
  if (file.fmt === 'arff') {
    const txt = await file.blob.text();
    const attrs = [], rows = [];
    let inData = false;
    for (const raw of txt.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('%')) continue;
      if (/^@attribute/i.test(line)) {
        const m = /^@attribute\s+('([^']+)'|"([^"]+)"|(\S+))/i.exec(line);
        if (m) attrs.push(m[2] || m[3] || m[4]);
      } else if (/^@data/i.test(line)) inData = true;
      else if (inData)
        rows.push(line.split(',').map(v => v.trim().replace(/^['"]|['"]$/g, '')));
    }
    if (!attrs.length) throw new Error('No @attribute declarations found in this ARFF file');
    return [attrs, ...rows];
  }
  // csv / tsv / xlsx / xls / ods via SheetJS
  const wb = XLSX.read(await file.blob.arrayBuffer(), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
}

function aoaToHtmlTable(aoa) {
  if (!aoa.length) return '<p>(empty)</p>';
  const [head, ...rows] = aoa;
  return `<table><thead><tr>${head.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>` +
    `<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

/* any doc-like file → { html, text } */
async function toDoc(file) {
  switch (file.fmt) {
    case 'txt': {
      const t = await file.blob.text();
      return { html: textToHtml(t), text: t };
    }
    case 'md': {
      const t = await file.blob.text();
      const h = marked.parse(t);
      return { html: h, text: stripHtml(h) };
    }
    case 'html': {
      const t = await file.blob.text();
      const body = new DOMParser().parseFromString(t, 'text/html').body.innerHTML;
      return { html: body, text: stripHtml(t) };
    }
    case 'rtf': {
      const t = rtfToText(await file.blob.text());
      return { html: textToHtml(t), text: t };
    }
    case 'docx': {
      const res = await mammoth.convertToHtml({ arrayBuffer: await file.blob.arrayBuffer() });
      return { html: res.value, text: stripHtml(res.value) };
    }
    case 'pdf':
      return pdfToDoc(file);
    case 'pptx':
      return parsePptx(file);
    case 'tex':
      return parseTex(await file.blob.text());
    case 'epub':
      return parseEpub(file);
    case 'py': case 'mcode': {
      const t = await file.blob.text();
      return { html: highlightCode(t, file.fmt), text: t };
    }
    case 'bib': {
      const entries = parseBib(await file.blob.text());
      if (!entries.length) throw new Error('No BibTeX entries found');
      const lines = entries.map((e, i) => ieeeOf(e, i + 1));
      return { html: lines.map(l => `<p>${esc(l)}</p>`).join('\n'), text: lines.join('\n') };
    }
    default: {
      if (FORMATS[file.fmt].kind === 'table') {
        const aoa = await toTable(file);
        return { html: aoaToHtmlTable(aoa), text: aoaToText(aoa) };
      }
      throw new Error(`Cannot read ${file.fmt} as a document`);
    }
  }
}

const aoaToText = aoa => aoa.map(r => r.join('\t')).join('\n');

/* image file → canvas */
async function fileToCanvas(file) {
  let bmp;
  if (file.fmt === 'svg') {
    const url = URL.createObjectURL(new Blob([await file.blob.text()], { type: 'image/svg+xml' }));
    const img = new Image();
    await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error('Cannot render SVG')); img.src = url; });
    const w = img.naturalWidth || 1024, h = img.naturalHeight || 1024;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    return c;
  }
  bmp = await createImageBitmap(file.blob);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close();
  return c;
}

/* pdf → array of page canvases */
async function pdfToCanvases(file, maxPages = 60) {
  const pdf = await getPdf(file);
  const out = [];
  const count = Math.min(pdf.numPages, maxPages);
  for (let p = 1; p <= count; p++) {
    const page = await pdf.getPage(p);
    const v1 = page.getViewport({ scale: 1 });
    const scale = Math.min(2, 1800 / v1.width);
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    // intent:'print' renders without requestAnimationFrame, so it also works in background tabs
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp, intent: 'print' }).promise;
    out.push(c);
  }
  return out;
}

/* audio/video file → AudioBuffer */
async function decodeAudio(file) {
  const ctx = new OfflineAudioContext(2, 44100, 44100);
  try {
    return await ctx.decodeAudioData(await file.blob.arrayBuffer());
  } catch {
    throw new Error('Could not decode audio track from this file');
  }
}

async function loadVideo(file) {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.src = URL.createObjectURL(file.blob);
  await new Promise((ok, bad) => {
    v.onloadeddata = ok;
    v.onerror = () => bad(new Error('Browser cannot decode this video codec'));
  });
  return v;
}

async function seekFrame(video, t, maxW = 960) {
  await new Promise(ok => { video.onseeked = ok; video.currentTime = t; });
  const scale = Math.min(1, maxW / video.videoWidth);
  const c = document.createElement('canvas');
  c.width = Math.round(video.videoWidth * scale);
  c.height = Math.round(video.videoHeight * scale);
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  return c;
}

/* ================= 4. Renderers ← intermediate representations ================= */

function makeBlob(content, fmt) {
  return new Blob([content], { type: FORMATS[fmt].mime });
}

function fullHtml(bodyHtml, title = 'Document') {
  return `<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>${esc(title)}</title>\n<style>body{font-family:Georgia,serif;max-width:820px;margin:40px auto;padding:0 20px;line-height:1.65;color:#1a1a2e}table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px 10px}img{max-width:100%}</style>\n</head><body>\n${bodyHtml}\n</body></html>`;
}

function textToRtf(text) {
  const escd = text.replace(/[\\{}]/g, c => '\\' + c)
    .replace(/[^\x00-\x7f]/g, c => `\\u${c.charCodeAt(0)}?`)
    .replace(/\n/g, '\\par\n');
  return `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Calibri;}}\\fs22\n${escd}\n}`;
}

/* --- HTML → block model (shared by DOCX + PDF writers) --- */
function htmlToBlocks(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks = [];
  const runsFrom = el => {
    const runs = [];
    (function walk(n, st) {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) { if (c.textContent) runs.push({ text: c.textContent, ...st }); }
        else if (c.nodeType === 1) {
          const tag = c.tagName.toLowerCase();
          if (tag === 'br') { runs.push({ text: '\n', ...st }); continue; }
          if (tag === 'img') { runs.push({ img: c.getAttribute('src') || '' }); continue; }
          const ns = { ...st };
          if (tag === 'b' || tag === 'strong') ns.bold = true;
          if (tag === 'i' || tag === 'em') ns.italic = true;
          if (tag === 'u') ns.underline = true;
          walk(c, ns);
        }
      }
    })(el, {});
    return runs;
  };
  const isBlockContainer = el =>
    [...el.children].some(c => /^(p|h[1-6]|ul|ol|table|div|section|article|blockquote|pre|figure)$/i.test(c.tagName));
  (function visit(node) {
    for (const el of node.children) {
      const tag = el.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) blocks.push({ type: tag, runs: runsFrom(el) });
      else if (tag === 'p') blocks.push({ type: 'p', runs: runsFrom(el) });
      else if (tag === 'ul' || tag === 'ol')
        [...el.querySelectorAll(':scope > li')].forEach((li, i) =>
          blocks.push({ type: 'li', ordered: tag === 'ol', index: i + 1, runs: runsFrom(li) }));
      else if (tag === 'table')
        blocks.push({ type: 'table', rows: [...el.querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.textContent.trim())) });
      else if (tag === 'img') blocks.push({ type: 'img', src: el.getAttribute('src') || '' });
      else if (tag === 'pre') blocks.push({ type: 'pre', runs: [{ text: el.textContent }] });
      else if (isBlockContainer(el)) visit(el);
      else if (el.textContent.trim()) blocks.push({ type: 'p', runs: runsFrom(el) });
    }
  })(doc.body);
  if (!blocks.length && doc.body.textContent.trim())
    blocks.push({ type: 'p', runs: [{ text: doc.body.textContent.trim() }] });
  return blocks;
}

/* --- DOCX writer (OOXML built with JSZip) --- */
const DOCX_HEAD_SIZES = { h1: 56, h2: 44, h3: 36, h4: 30, h5: 26, h6: 24 }; // half-points

function docxRunXml(r, headSz) {
  if (r.img || !r.text) return '';
  const props = [];
  if (r.bold || headSz) props.push('<w:b/>');
  if (r.italic) props.push('<w:i/>');
  if (r.underline) props.push('<w:u w:val="single"/>');
  if (headSz) props.push(`<w:sz w:val="${headSz}"/><w:szCs w:val="${headSz}"/>`);
  const pr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : '';
  const parts = esc(r.text).split('\n');
  return `<w:r>${pr}<w:t xml:space="preserve">${parts.join(`</w:t><w:br/><w:t xml:space="preserve">`)}</w:t></w:r>`;
}

/* renders a run, converting $...$ segments into native Word equations (OMML) */
function docxRunOrMath(r, headSz) {
  if (r.img || !r.text) return '';
  if (!r.text.includes('$')) return docxRunXml(r, headSz);
  let xml = '';
  r.text.split(/\$([^$]+)\$/).forEach((part, i) => {
    if (!part) return;
    if (i % 2) {
      try { xml += ommlFromTex(part); return; }
      catch { part = '$' + part + '$'; }
    }
    xml += docxRunXml({ ...r, text: part }, headSz);
  });
  return xml;
}

function docxParagraph(runs, headSz, prefix) {
  let inner = '';
  if (prefix) inner += docxRunXml({ text: prefix }, headSz);
  inner += runs.map(r => docxRunOrMath(r, headSz)).join('');
  return `<w:p>${inner || '<w:r><w:t/></w:r>'}</w:p>`;
}

function docxTable(rows) {
  const border = '<w:top w:val="single" w:sz="4" w:color="808080"/><w:left w:val="single" w:sz="4" w:color="808080"/><w:bottom w:val="single" w:sz="4" w:color="808080"/><w:right w:val="single" w:sz="4" w:color="808080"/><w:insideH w:val="single" w:sz="4" w:color="808080"/><w:insideV w:val="single" w:sz="4" w:color="808080"/>';
  const trs = rows.map(r =>
    `<w:tr>${r.map(c =>
      `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p><w:r><w:t xml:space="preserve">${esc(c)}</w:t></w:r></w:p></w:tc>`
    ).join('')}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${border}</w:tblBorders></w:tblPr>${trs}</w:tbl><w:p/>`;
}

/* decode a data: URL into raw bytes */
function dataUrlBytes(dataUrl) {
  const bin = atob(dataUrl.split(',')[1]);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

/* load any <img> src (data URL, blob or fetchable URL) → { u8, ext, w, h }, or null */
async function srcToImage(src) {
  try {
    let url = src;
    if (!src.startsWith('data:')) {
      const blob = await fetch(src).then(r => r.blob());
      url = await new Promise(ok => {
        const fr = new FileReader();
        fr.onload = () => ok(fr.result);
        fr.readAsDataURL(blob);
      });
    }
    const img = new Image();
    await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error('bad image')); img.src = url; });
    const w = img.naturalWidth || 300, h = img.naturalHeight || 200;
    if (/^data:image\/(png|jpeg)/.test(url))
      return { u8: dataUrlBytes(url), ext: url.startsWith('data:image/png') ? 'png' : 'jpeg', w, h };
    // normalize webp/gif/svg/etc to PNG so Office always accepts it
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0);
    return { u8: dataUrlBytes(c.toDataURL('image/png')), ext: 'png', w, h };
  } catch { return null; }
}

const EMU_PER_PX = 9525;                 // at 96 dpi
const DOCX_MAX_IMG_W = 5900000;          // ≈ printable A4 width in EMU

function docxDrawingXml(id, cx, cy) {
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="Picture ${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg${id}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

async function buildDocx(html) {
  const blocks = htmlToBlocks(html);
  const media = [];
  const addImage = async src => {
    if (!src) return '';
    const im = await srcToImage(src);
    if (!im) return '';
    media.push(im);
    let cx = Math.max(1, Math.round(im.w * EMU_PER_PX));
    let cy = Math.max(1, Math.round(im.h * EMU_PER_PX));
    if (cx > DOCX_MAX_IMG_W) { cy = Math.round(cy * DOCX_MAX_IMG_W / cx); cx = DOCX_MAX_IMG_W; }
    return docxDrawingXml(media.length, cx, cy);
  };
  let body = '';
  for (const b of blocks) {
    if (b.type === 'table') { body += docxTable(b.rows); continue; }
    if (b.type === 'img') { body += await addImage(b.src); continue; }
    for (const r of (b.runs || []).filter(r => r.img)) body += await addImage(r.img);
    const textRuns = (b.runs || []).filter(r => !r.img);
    if (!textRuns.length && (b.runs || []).length) continue; // image-only paragraph
    const headSz = DOCX_HEAD_SIZES[b.type];
    const prefix = b.type === 'li' ? (b.ordered ? `${b.index}. ` : '• ') : '';
    body += docxParagraph(textRuns, headSz, prefix);
  }
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Default Extension="jpeg" ContentType="image/jpeg"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  const imgRels = media.map((m, i) =>
    `<Relationship Id="rIdImg${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${i + 1}.${m.ext}"/>`).join('\n');
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${imgRels}
</Relationships>`);
  media.forEach((m, i) => zip.file(`word/media/image${i + 1}.${m.ext}`, m.u8));
  zip.file('word/document.xml', documentXml);
  return zip.generateAsync({ type: 'blob', mimeType: FORMATS.docx.mime });
}

/* --- XLSX with an embedded picture (anchored at A1, hand-built OOXML) --- */
async function xlsxWithImage(canvas) {
  const u8 = dataUrlBytes(whiteBacked(canvas).toDataURL('image/png'));
  const cx = Math.round(canvas.width * EMU_PER_PX), cy = Math.round(canvas.height * EMU_PER_PX);
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const relsDoc = body => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
</Types>`);
  zip.file('_rels/.rels', relsDoc(`<Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/>`));
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', relsDoc(`<Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/>`));
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R}"><sheetData/><drawing r:id="rId1"/></worksheet>`);
  zip.file('xl/worksheets/_rels/sheet1.xml.rels', relsDoc(`<Relationship Id="rId1" Type="${R}/drawing" Target="../drawings/drawing1.xml"/>`));
  zip.file('xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${cx}" cy="${cy}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Picture 1"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="${R}" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`);
  zip.file('xl/drawings/_rels/drawing1.xml.rels', relsDoc(`<Relationship Id="rId1" Type="${R}/image" Target="../media/image1.png"/>`));
  zip.file('xl/media/image1.png', u8);
  return zip.generateAsync({ type: 'blob', mimeType: FORMATS.xlsx.mime });
}

/* ================= 4b. PowerPoint · LaTeX · ePub · encryption · OCR · video ================= */

function loadScript(src) {
  return new Promise((ok, bad) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => bad(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}

/* --- PPTX writer (OOXML built with JSZip; h1/h2 start new slides) --- */
const OOXML_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PPTX_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="' + OOXML_R + '" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const PPTX_THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="OmniConvert"><a:themeElements>
<a:clrScheme name="OmniConvert"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="7C5CFF"/></a:accent1><a:accent2><a:srgbClr val="22D3EE"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>
<a:fontScheme name="OmniConvert"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="OmniConvert"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
</a:themeElements></a:theme>`;
const PPTX_EMPTY_TREE = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree>';

const EMU_SLIDE_W = 12192000, EMU_SLIDE_H = 6858000;

function pptxTableXml(rows, y, id) {
  const cols = Math.max(1, ...rows.map(r => r.length));
  const h = Math.min(2400000, rows.length * 370840 + 50000);
  const gridW = Math.floor(10820400 / cols);
  const xml = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="685800" y="${y}"/><a:ext cx="10820400" cy="${h}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${`<a:gridCol w="${gridW}"/>`.repeat(cols)}</a:tblGrid>${rows.map(r =>
    `<a:tr h="370840">${Array.from({ length: cols }, (_, i) =>
      `<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US" sz="1400"/><a:t>${esc(r[i] ?? '')}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`).join('')}</a:tr>`).join('')}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
  return { h, xml };
}

function pptxSlideXml(s, media) {
  const bulletPs = s.bullets.map(b =>
    `<a:p><a:pPr marL="285750" indent="-285750"><a:buChar char="•"/></a:pPr><a:r><a:rPr lang="en-US" sz="1800"/><a:t>${esc(b)}</a:t></a:r></a:p>`).join('');
  const hasExtras = s.tables.length || s.images.length;
  const bodyH = s.bullets.length
    ? (hasExtras ? Math.min(1900000, 400000 + s.bullets.length * 300000) : 4351338)
    : 0;
  let shapes =
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="365125"/><a:ext cx="10820400" cy="1325563"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="3200" b="1"/><a:t>${esc(s.title)}</a:t></a:r></a:p></p:txBody></p:sp>`;
  if (s.bullets.length)
    shapes += `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="1825625"/><a:ext cx="10820400" cy="${bodyH}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${bulletPs}</p:txBody></p:sp>`;
  let y = 1825625 + (s.bullets.length ? bodyH + 120000 : 0);
  let objId = 4;
  for (const rows of s.tables) {
    const t = pptxTableXml(rows, y, objId++);
    shapes += t.xml;
    y += t.h + 120000;
  }
  for (const mi of s.images) {
    const m = media[mi];
    let cx = Math.round((m.w || 400) * EMU_PER_PX), cy = Math.round((m.h || 300) * EMU_PER_PX);
    const maxW = 6800000, maxH = Math.max(900000, EMU_SLIDE_H - 260000 - y);
    if (cx > maxW) { cy = Math.round(cy * maxW / cx); cx = maxW; }
    if (cy > maxH) { cx = Math.round(cx * maxH / cy); cy = maxH; }
    shapes += `<p:pic><p:nvPicPr><p:cNvPr id="${objId}" name="Picture ${objId}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImg${mi + 1}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${Math.round((EMU_SLIDE_W - cx) / 2)}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
    objId++;
    y += cy + 120000;
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${PPTX_NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
${shapes}
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

async function buildPptx(html, title = 'Presentation') {
  const blocks = htmlToBlocks(html);
  const slides = [];
  const media = []; // { name, u8, w, h }
  let cur = null;
  const ensure = () => { if (!cur) { cur = { title, bullets: [], tables: [], images: [] }; slides.push(cur); } };
  const addImage = async src => {
    const im = await srcToImage(src);
    if (!im) return;
    media.push({ name: `image${media.length + 1}.${im.ext === 'jpeg' ? 'jpg' : im.ext}`, u8: im.u8, w: im.w, h: im.h });
    ensure();
    cur.images.push(media.length - 1);
  };
  for (const b of blocks) {
    const txt = (b.runs || []).map(r => r.text || '').join('').trim();
    if (b.type === 'h1' || b.type === 'h2') {
      cur = { title: txt || 'Slide', bullets: [], tables: [], images: [] };
      slides.push(cur);
      continue;
    }
    if (b.type === 'img') { await addImage(b.src); continue; }
    for (const r of (b.runs || []).filter(r => r.img)) await addImage(r.img);
    ensure();
    if (b.type === 'table') cur.tables.push(b.rows);
    else if (txt) cur.bullets.push((b.type === 'li' && b.ordered ? `${b.index}. ` : '') + txt);
  }
  if (!slides.length) slides.push({ title, bullets: [], tables: [], images: [] });
  const paged = [];
  for (const s of slides) {
    if (s.bullets.length <= 12) { paged.push(s); continue; }
    for (let i = 0; i < s.bullets.length; i += 12)
      paged.push({ title: i ? s.title + ' (cont.)' : s.title, bullets: s.bullets.slice(i, i + 12),
                   tables: i ? [] : s.tables, images: i ? [] : s.images });
  }
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Default Extension="jpg" ContentType="image/jpeg"/>
<Default Extension="gif" ContentType="image/gif"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
${paged.map((s, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('\n')}
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${OOXML_R}/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`);
  zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${OOXML_R}/slideMaster" Target="slideMasters/slideMaster1.xml"/>
${paged.map((s, i) => `<Relationship Id="rId${i + 2}" Type="${OOXML_R}/slide" Target="slides/slide${i + 1}.xml"/>`).join('\n')}
</Relationships>`);
  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation ${PPTX_NS}>
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst>${paged.map((s, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst>
<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`);
  zip.file('ppt/slideMasters/slideMaster1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster ${PPTX_NS}><p:cSld>${PPTX_EMPTY_TREE}</p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>`);
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${OOXML_R}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="${OOXML_R}/theme" Target="../theme/theme1.xml"/>
</Relationships>`);
  zip.file('ppt/slideLayouts/slideLayout1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout ${PPTX_NS} type="blank"><p:cSld>${PPTX_EMPTY_TREE}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${OOXML_R}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`);
  zip.file('ppt/theme/theme1.xml', PPTX_THEME);
  paged.forEach((s, i) => {
    zip.file(`ppt/slides/slide${i + 1}.xml`, pptxSlideXml(s, media));
    zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${OOXML_R}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
${s.images.map(mi => `<Relationship Id="rIdImg${mi + 1}" Type="${OOXML_R}/image" Target="../media/${media[mi].name}"/>`).join('\n')}
</Relationships>`);
  });
  media.forEach(m => zip.file(`ppt/media/${m.name}`, m.u8));
  return zip.generateAsync({ type: 'blob', mimeType: FORMATS.pptx.mime });
}

/* --- PPTX reader: text, pictures, tables and chart data — in true slide
       order, including shapes nested inside group shapes.
       Returns one structured entry per slide: { title, items:[{kind,…}] } --- */
async function parsePptxSlides(file) {
  const zip = await JSZip.loadAsync(file.blob);
  // true slide order comes from presentation.xml, not from file names
  let names = [];
  try {
    const relMap = {};
    [...new DOMParser().parseFromString(await zip.file('ppt/_rels/presentation.xml.rels').async('string'), 'application/xml')
      .getElementsByTagName('Relationship')].forEach(r => relMap[r.getAttribute('Id')] = r.getAttribute('Target'));
    const pdoc = new DOMParser().parseFromString(await zip.file('ppt/presentation.xml').async('string'), 'application/xml');
    names = [...pdoc.getElementsByTagName('p:sldId')]
      .map(s => relMap[s.getAttribute('r:id')])
      .filter(Boolean)
      .map(t => t.startsWith('/') ? t.slice(1) : 'ppt/' + t.replace(/^\.\.\//, ''));
  } catch { /* malformed presentation part → numeric fallback below */ }
  names = names.filter(n => zip.file(n));
  if (!names.length)
    names = Object.keys(zip.files)
      .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
  if (!names.length) throw new Error('No slides found in this PPTX');

  const slides = [];
  for (const name of names) {
    const xml = new DOMParser().parseFromString(await zip.file(name).async('string'), 'application/xml');
    const rels = {};
    const relsFile = zip.file(name.replace(/\/([^/]+)$/, '/_rels/$1.rels'));
    if (relsFile) {
      const rx = new DOMParser().parseFromString(await relsFile.async('string'), 'application/xml');
      [...rx.getElementsByTagName('Relationship')].forEach(r => rels[r.getAttribute('Id')] = r.getAttribute('Target'));
    }
    const resolvePath = t => t.startsWith('../') ? 'ppt/' + t.slice(3) : t.startsWith('/') ? t.slice(1) : 'ppt/slides/' + t;
    const mediaUrl = async rid => {
      const t = rels[rid];
      if (!t) return null;
      const path = resolvePath(t);
      const f = zip.file(path);
      if (!f) return null;
      const ext = path.split('.').pop().toLowerCase();
      const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
                     bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml' }[ext];
      if (!mime) return null; // emf/wmf vector media can't render in a browser
      return `data:${mime};base64,${await f.async('base64')}`;
    };
    // charts carry their cached data — extract it as a table
    const chartRows = async rid => {
      const t = rels[rid];
      if (!t) return null;
      const f = zip.file(resolvePath(t));
      if (!f) return null;
      try {
        const cx = new DOMParser().parseFromString(await f.async('string'), 'application/xml');
        const sers = [...cx.getElementsByTagName('c:ser')];
        if (!sers.length) return null;
        const pts = el => el ? [...el.getElementsByTagName('c:pt')].map(p =>
          (p.getElementsByTagName('c:v')[0] || {}).textContent || '') : [];
        const cats = pts(sers[0].getElementsByTagName('c:cat')[0]);
        const header = ['Category'];
        const cols = [];
        for (const s of sers) {
          const tx = s.getElementsByTagName('c:tx')[0];
          header.push((tx ? tx.textContent.trim() : '') || `Series ${cols.length + 1}`);
          cols.push(pts(s.getElementsByTagName('c:val')[0]));
        }
        const nRows = Math.max(cats.length, ...cols.map(c => c.length));
        if (!nRows) return null;
        const rows = [header];
        for (let i = 0; i < nRows; i++)
          rows.push([cats[i] ?? String(i + 1), ...cols.map(c => c[i] ?? '')]);
        return rows;
      } catch { return null; }
    };
    const items = [];
    const walk = async node => {
      for (const child of [...node.children]) {
        const ln = child.localName;
        if (ln === 'grpSp') { await walk(child); continue; }
        if (ln === 'sp') {
          const isTitle = [...child.getElementsByTagName('p:ph')].some(ph => /title/i.test(ph.getAttribute('type') || ''));
          for (const p of [...child.getElementsByTagName('a:p')]) {
            const pPr = [...p.children].find(c => c.localName === 'pPr');
            const lvl = pPr ? +(pPr.getAttribute('lvl') || 0) : 0;
            const para = [...p.children].map(c =>
              c.localName === 'br' ? ' ' :
              [...c.getElementsByTagName('a:t')].map(t => t.textContent).join('')
            ).join('').replace(/\s+/g, ' ').trim();
            if (para) items.push({ kind: isTitle ? 'title' : 'p', text: para, lvl });
          }
        } else if (ln === 'pic') {
          const blip = child.getElementsByTagName('a:blip')[0];
          const rid = blip && (blip.getAttribute('r:embed') || blip.getAttribute('embed'));
          const url = rid && await mediaUrl(rid);
          if (url) items.push({ kind: 'img', src: url });
        } else if (ln === 'graphicFrame') {
          const tbl = child.getElementsByTagName('a:tbl')[0];
          if (tbl) {
            const rows = [...tbl.getElementsByTagName('a:tr')].map(tr =>
              [...tr.getElementsByTagName('a:tc')].map(tc =>
                [...tc.getElementsByTagName('a:t')].map(t => t.textContent).join(' ').trim()));
            items.push({ kind: 'table', rows });
          } else {
            const chartRef = child.getElementsByTagName('c:chart')[0];
            const rid = chartRef && (chartRef.getAttribute('r:id') || chartRef.getAttribute('id'));
            if (rid) {
              const rows = await chartRows(rid);
              if (rows) items.push({ kind: 'table', rows });
            }
          }
        }
      }
    };
    const spTree = xml.getElementsByTagName('p:spTree')[0];
    if (spTree) await walk(spTree);
    // slide without a title placeholder → promote its first text paragraph;
    // image/table-only slides keep a generated title so no slide ever merges away
    let title = items.find(i => i.kind === 'title');
    if (!title) {
      const first = items.find(i => i.kind === 'p');
      if (first) { first.kind = 'title'; title = first; }
    }
    slides.push({
      title: title ? title.text : `Slide ${slides.length + 1}`,
      items: items.filter(i => i !== title && i.kind !== 'title')
        .concat(items.filter(i => i.kind === 'title' && i !== title).map(i => ({ kind: 'p', text: i.text, lvl: 0 }))),
    });
  }
  return slides;
}

/* PPTX → { html, text } built from the per-slide structure (one h2 per slide, always) */
async function parsePptx(file) {
  const slides = await parsePptxSlides(file);
  let html = '', text = '';
  for (const s of slides) {
    html += `<h2>${esc(s.title)}</h2>\n`;
    text += s.title + '\n';
    for (const it of s.items) {
      if (it.kind === 'p') {
        html += `<p>${it.lvl ? '&ndash; ' : ''}${esc(it.text)}</p>\n`;
        text += it.text + '\n';
      } else if (it.kind === 'img') html += `<img src="${it.src}">\n`;
      else if (it.kind === 'table') {
        html += aoaToHtmlTable(it.rows) + '\n';
        text += it.rows.map(r => r.join('\t')).join('\n') + '\n';
      }
    }
    text += '\n';
  }
  return { html: html.trim(), text: text.trim() };
}

/* PPTX → PDF that actually looks like slides: 16:9 landscape, one page per
   slide, title band, indented bullets, tables and centred images */
async function pptxToPdf(file) {
  const slides = await parsePptxSlides(file);
  const { jsPDF } = window.jspdf;
  const W = 960, H = 540, M = 56;
  const doc = new jsPDF({ unit: 'pt', format: [W, H], orientation: 'landscape' });
  let first = true;
  for (const s of slides) {
    if (!first) doc.addPage([W, H], 'landscape');
    first = false;
    doc.setFillColor(38, 42, 92);
    doc.rect(0, 0, W, 66, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.text(doc.splitTextToSize(pdfText(s.title), W - 2 * M).slice(0, 2), M, 40);
    doc.setTextColor(28, 30, 50);
    let y = 92;
    const BOT = H - 26;
    // start a continuation page and repeat the title (dimmed) so overflow reads clearly
    const carryPage = () => {
      doc.addPage([W, H], 'landscape');
      doc.setFillColor(38, 42, 92);
      doc.rect(0, 0, W, 66, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(22);
      doc.text(doc.splitTextToSize(pdfText(s.title) + ' (cont.)', W - 2 * M).slice(0, 2), M, 40);
      doc.setTextColor(28, 30, 50);
      y = 92;
    };
    // emit pre-wrapped lines one at a time; page-break before any line that won't fit
    const emitLines = (lines, x, lineH, fontSize) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(fontSize);
      for (const line of lines) {
        if (y + lineH > BOT) carryPage();
        doc.text(line, x, y + fontSize);
        y += lineH;
      }
    };
    for (const it of s.items) {
      if (it.kind === 'p') {
        const indent = M + (it.lvl ? Math.min(it.lvl, 3) * 26 : 0);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(14);
        const lines = doc.splitTextToSize((it.lvl ? '-  ' : '•  ') + pdfText(it.text), W - indent - M);
        emitLines(lines, indent, 19, 14);
        y += 5;
      } else if (it.kind === 'table') {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        for (const row of it.rows) {
          const lines = doc.splitTextToSize(row.map(pdfText).join('   |   '), W - 2 * M);
          emitLines(lines, M, 15, 11);
          y += 2;
        }
        y += 10;
      } else if (it.kind === 'img' && it.src.startsWith('data:image/')) {
        try {
          const img = new Image();
          await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = it.src; });
          const ratio = img.naturalHeight / Math.max(1, img.naturalWidth);
          let w = Math.min(W * 0.58, img.naturalWidth * 0.75);
          let h = w * ratio;
          // never let an image exceed one page's height; fresh page if it can't fit here
          const maxH = H - 92 - 26;
          if (h > maxH) { h = maxH; w = h / ratio; }
          if (y + h > BOT && y > 92) carryPage();
          doc.addImage(it.src, it.src.includes('png') ? 'PNG' : 'JPEG', (W - w) / 2, y, w, h);
          y += h + 12;
        } catch { /* undecodable image — skip */ }
      }
    }
  }
  return doc.output('blob');
}

/* --- LaTeX writer --- */
const TEX_ESC = { '\\': '\\textbackslash{}', '&': '\\&', '%': '\\%', '$': '\\$', '#': '\\#', '_': '\\_', '{': '\\{', '}': '\\}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' };

/* Unicode → LaTeX so PPTX/DOCX content (smart quotes, bullets, dashes,
   arrows, currency, Greek…) compiles cleanly instead of erroring. */
const TEX_UNICODE = {
  '“': '``', '”': "''", '‘': '`', '’': "'", '‚': ',', '„': ',,',
  '‐': '-', '‑': '-', '‒': '-', '–': '--', '—': '---', '―': '---', '−': '$-$', '…': '\\ldots{}',
  '•': '\\textbullet{} ', '◦': '\\textopenbullet{} ', '·': '\\textperiodcentered{}', '▪': '\\textbullet{} ', '➢': '$\\Rightarrow$ ', '✓': '$\\checkmark$', '✔': '$\\checkmark$',
  '°': '\\textdegree{}', '±': '$\\pm$', '×': '$\\times$', '÷': '$\\div$', 'µ': '$\\mu$',
  '≤': '$\\leq$', '≥': '$\\geq$', '≠': '$\\neq$', '≈': '$\\approx$', '∞': '$\\infty$',
  '→': '$\\rightarrow$', '←': '$\\leftarrow$', '⇒': '$\\Rightarrow$', '⇐': '$\\Leftarrow$', '↔': '$\\leftrightarrow$', '↑': '$\\uparrow$', '↓': '$\\downarrow$',
  '©': '\\textcopyright{}', '®': '\\textregistered{}', '™': '\\texttrademark{}',
  '§': '\\S{}', '¶': '\\P{}', '†': '\\dag{}', '‡': '\\ddag{}',
  '€': '\\texteuro{}', '£': '\\pounds{}', '¥': '\\textyen{}', '₹': 'Rs.~', '¢': '\\textcent{}',
  '¼': '$\\frac{1}{4}$', '½': '$\\frac{1}{2}$', '¾': '$\\frac{3}{4}$',
  ' ': '~', '​': '', '‌': '', '‍': '', '﻿': '', ' ': ' ', ' ': ' ',
  '′': "$'$", '″': "$''$",
};
let SYM_TEXT_MAP = null;

function texEsc(s) {
  if (!SYM_TEXT_MAP) {
    SYM_TEXT_MAP = {};
    for (const [name, ch] of Object.entries(TEX_MATH_SYMS)) SYM_TEXT_MAP[ch] = `$\\${name}$`;
  }
  return stripCtl(s)
    .replace(/[\\&%$#_{}~^]/g, c => TEX_ESC[c])
    .replace(/[-￿]/g, ch =>
      TEX_UNICODE[ch] !== undefined ? TEX_UNICODE[ch]
      : SYM_TEXT_MAP[ch] !== undefined ? SYM_TEXT_MAP[ch]
      : (ch.charCodeAt(0) >= 0x00C0 && ch.charCodeAt(0) <= 0x024F) ? ch   // accented latin: utf8 inputenc handles
      : '');                                                              // emoji & unsupported glyphs: dropped
}

function texRuns(runs) {
  return (runs || []).map(r => {
    if (r.img || !r.text) return '';
    // keep $...$ math segments verbatim (control chars still stripped), escape everything else
    let t = r.text.split(/(\$[^$]+\$)/)
      .map(seg => /^\$[^$]+\$$/.test(seg) ? stripCtl(seg) : texEsc(seg)).join('');
    if (r.bold) t = `\\textbf{${t}}`;
    if (r.italic) t = `\\textit{${t}}`;
    return t;
  }).join('');
}

const TEX_PREAMBLE = '\\documentclass{article}\n\\usepackage[utf8]{inputenc}\n\\usepackage[T1]{fontenc}\n\\usepackage{textcomp}\n\\usepackage{amsmath,amssymb}\n\\usepackage{graphicx}\n\\begin{document}\n\n';

/* doc HTML → { tex, images } — images become media/imageN.* + \includegraphics */
async function texFromDoc(html) {
  const blocks = htmlToBlocks(html);
  const images = [];
  const addImg = async src => {
    const im = await srcToImage(src);
    if (!im) return '';
    const name = `image${images.length + 1}.${im.ext === 'jpeg' ? 'jpg' : im.ext}`;
    images.push({ name, u8: im.u8 });
    return `\\begin{figure}[h]\n\\centering\n\\includegraphics[width=0.8\\linewidth]{media/${name}}\n\\end{figure}\n\n`;
  };
  let out = TEX_PREAMBLE;
  let list = null;
  const closeList = () => { if (list) { out += `\\end{${list}}\n\n`; list = null; } };
  for (const b of blocks) {
    if (b.type === 'li') {
      const kind = b.ordered ? 'enumerate' : 'itemize';
      if (list !== kind) { closeList(); out += `\\begin{${kind}}\n`; list = kind; }
      out += `  \\item ${texRuns(b.runs)}\n`;
      continue;
    }
    closeList();
    if (b.type === 'img') { out += await addImg(b.src); continue; }
    for (const r of (b.runs || []).filter(r => r.img)) out += await addImg(r.img);
    if (b.type === 'h1') out += `\\section{${texRuns(b.runs)}}\n\n`;
    else if (b.type === 'h2') out += `\\subsection{${texRuns(b.runs)}}\n\n`;
    else if (/^h[3-6]$/.test(b.type)) out += `\\subsubsection{${texRuns(b.runs)}}\n\n`;
    else if (b.type === 'table') {
      const cols = Math.max(1, ...b.rows.map(r => r.length));
      out += `\\begin{tabular}{|${'l|'.repeat(cols)}}\n\\hline\n` +
        b.rows.map(r => r.map(texEsc).join(' & ') + ' \\\\ \\hline').join('\n') +
        '\n\\end{tabular}\n\n';
    } else if (b.type === 'pre')
      out += `\\begin{verbatim}\n${(b.runs || []).map(r => r.text || '').join('')}\n\\end{verbatim}\n\n`;
    else {
      const t = texRuns(b.runs);
      if (t.trim()) out += t + '\n\n';
    }
  }
  closeList();
  return { tex: out + '\\end{document}\n', images };
}

/* package LaTeX + its images: plain .tex when there are none, zip with media/ otherwise */
async function texResult(file, tex, images) {
  tex = stripCtl(tex);   // final guarantee: no C0 control chars ever reach a .tex
  if (!images || !images.length)
    return [{ name: outName(file.name, 'tex'), blob: makeBlob(tex, 'tex'), fmt: 'tex' }];
  const zip = new JSZip();
  zip.file(baseName(file.name).replace(/[^\w.-]+/g, '_') + '.tex', tex);
  for (const im of images) zip.file('media/' + im.name, im.u8);
  return [{ name: baseName(file.name) + '-latex.zip',
            blob: await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' }), fmt: 'zip' }];
}

/* --- LaTeX reader (heuristic; keeps structure, strips unknown commands) --- */
function parseTex(src) {
  const maths = [];
  let s = src.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/(^|[^\\])%.*$/gm, '$1')
    // protect math so command-stripping below never touches it
    .replace(/\$\$([^$]+)\$\$|\\\[([\s\S]*?)\\\]/g, (m, a, b) => { maths.push('$' + (a || b).trim() + '$'); return `${maths.length - 1}`; })
    .replace(/\$([^$\n]+)\$/g, m => { maths.push(m); return `${maths.length - 1}`; })
    // beamer slides → headings (frame options like [allowframebreaks] allowed)
    .replace(/\\begin\{frame\}(?:\[[^\]]*\])?\{([^}]*)\}/g, '\n\n<h2>$1</h2>\n\n')
    .replace(/\\frametitle\{([^}]*)\}/g, '\n\n<h2>$1</h2>\n\n')
    .replace(/\\begin\{frame\}(?:\[[^\]]*\])?|\\end\{frame\}|\\framebreak|\\usetheme\{[^}]*\}|\\frame\{\\titlepage\}|\\titlepage/g, '')
    .replace(/\\documentclass(\[[^\]]*\])?\{[^}]*\}|\\usepackage(\[[^\]]*\])?\{[^}]*\}|\\begin\{document\}|\\end\{document\}|\\maketitle|\\tableofcontents/g, '')
    .replace(/\\title\{([^}]*)\}/g, '\n\n<h1>$1</h1>\n\n')
    .replace(/\\(author|date)\{([^}]*)\}/g, '\n\n<p style="text-align:center">$2</p>\n\n')
    .replace(/\\section\*?\{([^}]*)\}/g, '\n\n<h1>$1</h1>\n\n')
    .replace(/\\subsection\*?\{([^}]*)\}/g, '\n\n<h2>$1</h2>\n\n')
    .replace(/\\subsubsection\*?\{([^}]*)\}/g, '\n\n<h3>$1</h3>\n\n')
    .replace(/\\textbf\{([^}]*)\}/g, '<b>$1</b>')
    .replace(/\\textit\{([^}]*)\}|\\emph\{([^}]*)\}/g, (m, a, b) => `<i>${a ?? b}</i>`)
    .replace(/\\texttt\{([^}]*)\}/g, '<code>$1</code>')
    .replace(/\\begin\{(itemize|enumerate)\}/g, (m, k) => k === 'enumerate' ? '\n<ol>' : '\n<ul>')
    .replace(/\\end\{(itemize|enumerate)\}/g, (m, k) => k === 'enumerate' ? '</ol>\n' : '</ul>\n')
    .replace(/\\item\s+([^\n\\]*)/g, '<li>$1</li>')
    .replace(/\\textbackslash\{\}/g, '&#92;')
    .replace(/\\textasciitilde\{\}/g, '~')
    .replace(/\\textasciicircum\{\}/g, '^')
    .replace(/\\\\(\[[^\]]*\])?/g, '<br>')
    .replace(/\\([&%$#_{}])/g, '$1')
    .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?(\{([^{}]*)\})?/g, (m, opt, grp, inner) => inner || '')
    .replace(/[{}]/g, '')
    .replace(/(\d+)/g, (m, i) => maths[+i]);
  const html = s.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
    .map(p => /^&lt;|^<(h\d|ul|ol|li|p\b)/.test(p) && /^</.test(p) ? p : `<p>${p.replace(/\n/g, ' ')}</p>`)
    .join('\n');
  return { html, text: stripHtml(html) };
}

/* --- ePub writer/reader --- */
function toXhtml(html) {
  const d = new DOMParser().parseFromString(html, 'text/html');
  return new XMLSerializer().serializeToString(d.body)
    .replace(/^<body[^>]*>/, '').replace(/<\/body>$/, '');
}

async function buildEpub(html, title = 'Document') {
  const uuid = crypto.randomUUID ? crypto.randomUUID() : 'omni-' + Date.now();
  // extract images into OEBPS/images/* — readers reject data: URIs
  const hdoc = new DOMParser().parseFromString(html, 'text/html');
  const media = [];
  for (const img of [...hdoc.querySelectorAll('img')]) {
    const im = await srcToImage(img.getAttribute('src') || '');
    if (!im) { img.remove(); continue; }
    const name = `images/image${media.length + 1}.${im.ext === 'jpeg' ? 'jpg' : im.ext}`;
    media.push({ name, u8: im.u8, mime: im.ext === 'png' ? 'image/png' : 'image/jpeg' });
    img.setAttribute('src', name);
    img.setAttribute('alt', img.getAttribute('alt') || 'figure');
  }
  html = hdoc.body.innerHTML;
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">urn:uuid:${uuid}</dc:identifier>
<dc:title>${esc(title)}</dc:title>
<dc:language>en</dc:language>
<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
${media.map((m, i) => `<item id="img${i + 1}" href="${m.name}" media-type="${m.mime}"/>`).join('\n')}
</manifest>
<spine><itemref idref="ch1"/></spine>
</package>`);
  media.forEach(m => zip.file('OEBPS/' + m.name, m.u8));
  zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${esc(title)}</title></head>
<body><nav epub:type="toc"><h1>Contents</h1><ol><li><a href="chapter1.xhtml">${esc(title)}</a></li></ol></nav></body></html>`);
  zip.file('OEBPS/chapter1.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${esc(title)}</title></head><body>
${toXhtml(html)}
</body></html>`);
  return zip.generateAsync({ type: 'blob', mimeType: FORMATS.epub.mime });
}

async function parseEpub(file) {
  const zip = await JSZip.loadAsync(file.blob);
  const containerXml = await zip.file('META-INF/container.xml').async('string');
  const opfPath = (/full-path="([^"]+)"/.exec(containerXml) || [])[1];
  if (!opfPath || !zip.file(opfPath)) throw new Error('Invalid ePub (missing OPF package)');
  const opf = new DOMParser().parseFromString(await zip.file(opfPath).async('string'), 'application/xml');
  const dir = opfPath.includes('/') ? opfPath.replace(/\/[^/]*$/, '/') : '';
  const items = {};
  [...opf.getElementsByTagName('item')].forEach(it => items[it.getAttribute('id')] = it.getAttribute('href'));
  const hrefs = [...opf.getElementsByTagName('itemref')].map(ir => items[ir.getAttribute('idref')]).filter(Boolean);
  let html = '';
  for (const href of hrefs) {
    const f = zip.file(dir + decodeURIComponent(href)) || zip.file(decodeURIComponent(href));
    if (!f) continue;
    const doc = new DOMParser().parseFromString(await f.async('string'), 'text/html');
    // inline chapter images so they survive conversion to other formats
    for (const img of [...doc.querySelectorAll('img')]) {
      const src = decodeURIComponent(img.getAttribute('src') || '');
      if (!src || src.startsWith('data:')) continue;
      const chDir = href.includes('/') ? href.replace(/\/[^/]*$/, '/') : '';
      const imgFile = zip.file(dir + chDir + src) || zip.file(dir + src) || zip.file(src);
      if (!imgFile) { img.remove(); continue; }
      const ext = src.split('.').pop().toLowerCase();
      const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }[ext];
      if (!mime) { img.remove(); continue; }
      img.setAttribute('src', `data:${mime};base64,${await imgFile.async('base64')}`);
    }
    html += doc.body.innerHTML + '\n';
  }
  if (!html.trim()) throw new Error('No readable chapters in this ePub');
  return { html, text: stripHtml(html) };
}

/* --- AES-256-GCM file encryption (Web Crypto; PBKDF2-derived key) --- */
const ENC_MAGIC = 'OMNIENC1';

async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function encryptFile(f, password) {
  const pw = password ?? prompt(`Set a password to encrypt "${f.name}":`);
  if (!pw) throw new Error('Encryption cancelled — no password given');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pw, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, await f.blob.arrayBuffer()));
  const nameBytes = new TextEncoder().encode(f.name);
  const head = new Uint8Array(10 + nameBytes.length);
  head.set(new TextEncoder().encode(ENC_MAGIC));
  head[8] = nameBytes.length >> 8; head[9] = nameBytes.length & 255;
  head.set(nameBytes, 10);
  return { name: f.name + '.enc', fmt: 'enc',
           blob: new Blob([head, salt, iv, ct], { type: 'application/octet-stream' }) };
}

async function decryptFile(f, password) {
  const bytes = new Uint8Array(await f.blob.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 8)) !== ENC_MAGIC)
    throw new Error('Not an OmniConvert-encrypted file');
  const nameLen = (bytes[8] << 8) | bytes[9];
  const name = new TextDecoder().decode(bytes.slice(10, 10 + nameLen));
  const off = 10 + nameLen;
  const pw = password ?? prompt(`Enter the password for "${name}":`);
  if (!pw) throw new Error('Decryption cancelled — no password given');
  const key = await deriveKey(pw, bytes.slice(off, off + 16));
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(off + 16, off + 28) }, key, bytes.slice(off + 28));
  } catch { throw new Error('Wrong password (or the file is corrupted)'); }
  return { name, fmt: detectFmt(name) || 'txt', blob: new Blob([plain]) };
}

/* --- OCR (Tesseract.js, vendored — scanned PDFs and image→text) --- */
let ocrWorkerP;
function ensureOcr() {
  if (!ocrWorkerP) {
    ocrWorkerP = (async () => {
      if (typeof Tesseract === 'undefined') await loadScript('vendor/tesseract/tesseract.min.js');
      const base = new URL('vendor/tesseract/', location.href).href;
      return Tesseract.createWorker('eng', 1, {
        workerPath: base + 'worker.min.js',
        corePath: base + 'tesseract-core-simd-lstm.wasm.js',
        langPath: base.replace(/\/$/, ''),
        gzip: true,
      });
    })();
    ocrWorkerP.catch(() => { ocrWorkerP = null; });
  }
  return ocrWorkerP;
}

async function ocrCanvas(canvas) {
  const worker = await ensureOcr();
  const { data } = await worker.recognize(canvas);
  return (data.text || '').trim();
}

/* --- PDF compression ---
   'lossless' re-saves with object streams (structure-only, zero loss).
   Raster modes re-encode every page as JPEG at a chosen DPI — huge savings on
   scanned/image-heavy PDFs; text stays readable but becomes non-selectable. */
async function compressPdf(f, mode, quality = 0.7, onStep) {
  if (mode === 'lossless') {
    const doc = await PDFLib.PDFDocument.load(await f.blob.arrayBuffer(), { updateMetadata: false });
    return new Blob([await doc.save({ useObjectStreams: true })], { type: 'application/pdf' });
  }
  const dpi = mode === 'hq' ? 200 : mode === 'balanced' ? 150 : 110;
  const pdf = await getPdf(f);
  const out = await PDFLib.PDFDocument.create();
  for (let p = 1; p <= pdf.numPages; p++) {
    if (onStep) onStep(p, pdf.numPages);
    const page = await pdf.getPage(p);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = Math.min(dpi / 72, 4000 / vp1.width);
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
    const jpg = await canvasToBlobP(c, 'image/jpeg', quality);
    const img = await out.embedJpg(await jpg.arrayBuffer());
    const pg = out.addPage([vp1.width, vp1.height]);
    pg.drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });
    c.width = c.height = 1; // release canvas memory on large documents
  }
  return new Blob([await out.save({ useObjectStreams: true })], { type: 'application/pdf' });
}

/* --- video → MP4 / WebM transcoding (MediaRecorder, runs at playback speed) --- */
async function transcodeVideo(file, target) {
  const candidates = target === 'mp4'
    ? ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"', 'video/mp4;codecs=avc1', 'video/mp4']
    : ['video/webm;codecs="vp9,opus"', 'video/webm;codecs="vp8,opus"', 'video/webm'];
  const mime = candidates.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error(`This browser cannot encode ${target.toUpperCase()} — try ${target === 'mp4' ? 'WebM' : 'MP4'} instead`);
  const v = document.createElement('video');
  v.src = URL.createObjectURL(file.blob);
  v.playsInline = true;
  await new Promise((ok, bad) => { v.onloadeddata = ok; v.onerror = () => bad(new Error('Browser cannot decode this video codec')); });
  // route audio through WebAudio so the capture keeps sound without playing it aloud
  let stream;
  try {
    const ctx = new AudioContext();
    await ctx.resume().catch(() => {});
    const dest = ctx.createMediaStreamDestination();
    ctx.createMediaElementSource(v).connect(dest);
    stream = new MediaStream([...v.captureStream().getVideoTracks(), ...dest.stream.getAudioTracks()]);
  } catch {
    v.muted = true;
    stream = v.captureStream();
  }
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4000000 });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((ok, bad) => { rec.onstop = ok; rec.onerror = e => bad(e.error || new Error('Recording failed')); });
  try { await v.play(); }
  catch { v.muted = true; await v.play(); }   // autoplay policy: retry silently
  rec.start(250);
  await new Promise(ok => { v.onended = ok; });
  rec.stop();
  await stopped;
  URL.revokeObjectURL(v.src);
  if (!chunks.length) throw new Error('No frames captured from this video');
  return new Blob(chunks, { type: mime.split(';')[0] });
}

/* ================= 4c. Scientific & data engine ================= */

/* --- table structure from positioned word boxes (rows by baseline,
       columns by horizontal whitespace) — powers image/PDF → CSV/XLSX --- */
function boxesToTable(words) {
  const ws = words.filter(w => w.text && w.text.trim());
  if (!ws.length) return null;
  const median = arr => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const hMed = Math.max(4, median(ws.map(w => w.y1 - w.y0)));
  ws.sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1));
  const rows = [];
  for (const w of ws) {
    const yc = (w.y0 + w.y1) / 2;
    let row = rows[rows.length - 1];
    if (!row || Math.abs(yc - row.yc) > hMed * 0.7) { row = { yc, words: [] }; rows.push(row); }
    row.words.push(w);
    row.yc = row.words.reduce((s, x) => s + (x.y0 + x.y1) / 2, 0) / row.words.length;
  }
  // columns = union of x-intervals: words of different columns never overlap
  const tol = hMed * 0.45;
  const iv = ws.map(w => [w.x0, w.x1]).sort((a, b) => a[0] - b[0]);
  const cols = [];
  for (const [a, b] of iv) {
    const last = cols[cols.length - 1];
    if (last && a <= last[1] + tol) last[1] = Math.max(last[1], b);
    else cols.push([a, b]);
  }
  return rows.map(r => {
    const cells = cols.map(() => []);
    for (const w of r.words) {
      const cx = (w.x0 + w.x1) / 2;
      let ci = cols.findIndex(([a, b]) => cx >= a - tol && cx <= b + tol);
      if (ci < 0) ci = 0;
      cells[ci].push(w);
    }
    return cells.map(cell => cell.sort((a, b) => a.x0 - b.x0).map(w => w.text.trim()).join(' '));
  });
}

async function imageToTable(canvas) {
  const worker = await ensureOcr();
  const { data } = await worker.recognize(whiteBacked(canvas));
  const words = (data.words || []).filter(w => w.confidence > 25 && w.bbox).map(w =>
    ({ text: w.text, x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1 }));
  return boxesToTable(words);
}

async function pdfToTable(file) {
  const pdf = await getPdf(file);
  const words = [];
  let yOff = 0;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const size = Math.hypot(it.transform[2], it.transform[3]) || 10;
      const yTop = yOff + (vp.height - it.transform[5]) - size;
      // split a text chunk on runs of 2+ spaces (column gaps inside one item)
      let pos = 0;
      for (const part of it.str.split(/(\s{2,})/)) {
        if (part.trim()) {
          const w = it.width || size;
          words.push({ text: part.trim(),
            x0: it.transform[4] + w * (pos / it.str.length),
            x1: it.transform[4] + w * ((pos + part.length) / it.str.length),
            y0: yTop, y1: yTop + size });
        }
        pos += part.length;
      }
    }
    yOff += vp.height + 60;
  }
  if (words.length) {
    const t = boxesToTable(words);
    if (t && t.length) return t;
  }
  // scanned PDF → OCR word boxes per page
  const canvases = await pdfToCanvases(file, 10);
  const worker = await ensureOcr();
  const oWords = [];
  let oy = 0;
  for (const c of canvases) {
    const { data } = await worker.recognize(c);
    for (const w of (data.words || []).filter(w => w.confidence > 25 && w.bbox))
      oWords.push({ text: w.text, x0: w.bbox.x0, x1: w.bbox.x1, y0: oy + w.bbox.y0, y1: oy + w.bbox.y1 });
    oy += c.height + 120;
  }
  const t = boxesToTable(oWords);
  if (!t || !t.length) throw new Error('No table content found in this PDF');
  return t;
}

/* --- plain text → table (delimiter sniffing: tab / ; / , / 2+ spaces) --- */
function txtToTable(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) throw new Error('The file is empty');
  const probe = lines[0];
  const delim = probe.includes('\t') ? '\t'
    : (probe.includes(';') && !probe.includes(',')) ? ';'
    : probe.includes(',') ? ','
    : /\s{2,}/;
  return lines.map(l => l.split(delim).map(c => String(c).trim()));
}

/* --- code (Python / MATLAB) → highlighted HTML & LaTeX listings --- */
function highlightCode(code, lang) {
  let h = esc(code);
  h = h.replace(/(&quot;[^\n]*?&quot;|&#39;[^\n]*?&#39;)/g, '<span style="color:#c0392b">$1</span>');
  h = h.replace(lang === 'py' ? /(#[^\n]*)/g : /(%[^\n]*)/g, '<span style="color:#7f8c8d;font-style:italic">$1</span>');
  const kw = lang === 'py'
    ? /\b(def|class|import|from|return|if|elif|else|for|while|try|except|finally|with|as|lambda|yield|pass|break|continue|in|is|not|and|or|None|True|False|print|self|raise|global|nonlocal|assert|async|await)\b/g
    : /\b(function|end|if|elseif|else|for|while|switch|case|otherwise|return|break|continue|global|persistent|true|false|classdef|properties|methods|parfor|try|catch)\b/g;
  h = h.replace(kw, '<span style="color:#1a3faa;font-weight:bold">$1</span>');
  return `<pre style="background:#f6f7fb;padding:14px;border-radius:8px;overflow:auto;font-size:13px;line-height:1.5">${h}</pre>`;
}

function texFromCode(code, lang) {
  return `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{listings}
\\usepackage{xcolor}
\\lstset{basicstyle=\\ttfamily\\small,keywordstyle=\\color{blue}\\bfseries,commentstyle=\\color{gray}\\itshape,stringstyle=\\color{red},numbers=left,numberstyle=\\tiny,breaklines=true,showstringspaces=false,frame=single,language=${lang === 'py' ? 'Python' : 'Matlab'}}
\\begin{document}
\\section*{${lang === 'py' ? 'Python' : 'MATLAB'} listing}
\\begin{lstlisting}
${code}
\\end{lstlisting}
\\end{document}
`;
}

/* --- PPTX → LaTeX beamer (bullets, tables and slide images) --- */
async function buildBeamer(html, title = 'Presentation') {
  const blocks = htmlToBlocks(html);
  const frames = [];
  const images = [];
  let cur = null;
  const ensure = () => { if (!cur) { cur = { title, bullets: [], tabs: [], figs: [] }; frames.push(cur); } };
  const addImg = async src => {
    const im = await srcToImage(src);
    if (!im) return;
    const name = `image${images.length + 1}.${im.ext === 'jpeg' ? 'jpg' : im.ext}`;
    images.push({ name, u8: im.u8 });
    ensure();
    cur.figs.push(name);
  };
  for (const b of blocks) {
    const txt = (b.runs || []).map(r => r.text || '').join('').trim();
    if (b.type === 'h1' || b.type === 'h2') { cur = { title: txt || 'Slide', bullets: [], tabs: [], figs: [] }; frames.push(cur); continue; }
    if (b.type === 'img') { await addImg(b.src); continue; }
    for (const r of (b.runs || []).filter(r => r.img)) await addImg(r.img);
    ensure();
    if (b.type === 'table') cur.tabs.push(b.rows);
    else if (txt) cur.bullets.push(txt);
  }
  if (!frames.length) frames.push({ title, bullets: [], tabs: [], figs: [] });
  let out = `\\documentclass{beamer}\n\\usetheme{Madrid}\n\\usepackage[utf8]{inputenc}\n\\usepackage{textcomp}\n\\usepackage{graphicx}\n\\title{${texEsc(title)}}\n\\begin{document}\n\\frame{\\titlepage}\n\n`;
  for (const f of frames) {
    // allowframebreaks: long slides continue on follow-up frames instead of overflowing
    out += `\\begin{frame}[allowframebreaks]{${texEsc(f.title)}}\n`;
    if (f.bullets.length) {
      out += '\\begin{itemize}\n';
      let sub = false;
      for (const b of f.bullets) {
        const isSub = b.startsWith('– ');
        if (isSub && !sub) { out += '  \\begin{itemize}\n'; sub = true; }
        if (!isSub && sub) { out += '  \\end{itemize}\n'; sub = false; }
        out += `  \\item ${texEsc(isSub ? b.slice(2) : b)}\n`;
      }
      if (sub) out += '  \\end{itemize}\n';
      out += '\\end{itemize}\n';
    }
    for (const rows of f.tabs) {
      const cols = Math.max(1, ...rows.map(r => r.length));
      out += `\\begin{center}\\small\\begin{tabular}{|${'l|'.repeat(cols)}}\n\\hline\n` +
        rows.map(r => Array.from({ length: cols }, (_, i) => texEsc(r[i] ?? '')).join(' & ') + ' \\\\ \\hline').join('\n') +
        `\n\\end{tabular}\\end{center}\n`;
    }
    for (const fig of f.figs)
      out += `\\begin{center}\\includegraphics[width=0.7\\linewidth,height=0.55\\textheight,keepaspectratio]{media/${fig}}\\end{center}\n`;
    out += `\\end{frame}\n\n`;
  }
  return { tex: out + '\\end{document}\n', images };
}

/* --- equations: LaTeX ↔ OMML (Word native math) --- */
const TEX_MATH_SYMS = { alpha:'α',beta:'β',gamma:'γ',delta:'δ',epsilon:'ε',zeta:'ζ',eta:'η',theta:'θ',iota:'ι',kappa:'κ',lambda:'λ',mu:'μ',nu:'ν',xi:'ξ',pi:'π',rho:'ρ',sigma:'σ',tau:'τ',upsilon:'υ',phi:'φ',chi:'χ',psi:'ψ',omega:'ω',Gamma:'Γ',Delta:'Δ',Theta:'Θ',Lambda:'Λ',Xi:'Ξ',Pi:'Π',Sigma:'Σ',Upsilon:'Υ',Phi:'Φ',Psi:'Ψ',Omega:'Ω',infty:'∞',pm:'±',mp:'∓',times:'×',cdot:'⋅',div:'÷',leq:'≤',geq:'≥',neq:'≠',approx:'≈',equiv:'≡',rightarrow:'→',leftarrow:'←',Rightarrow:'⇒',partial:'∂',nabla:'∇',in:'∈',notin:'∉',subset:'⊂',supset:'⊃',cup:'∪',cap:'∩',forall:'∀',exists:'∃',emptyset:'∅',ldots:'…',cdots:'⋯' };
const SYM_TO_TEX = Object.fromEntries(Object.entries(TEX_MATH_SYMS).map(([k, v]) => [v, `\\${k} `]));
const NARY_CHARS = { sum: '∑', int: '∫', prod: '∏', oint: '∮', bigcup: '⋃', bigcap: '⋂' };

function parseTexMath(src) {
  let i = 0;
  function group() {
    if (src[i] === '{') {
      i++;
      const nodes = seq('}');
      i++;
      return nodes;
    }
    return [atom()];
  }
  function atom() {
    if (src[i] === '\\') {
      const m = /^\\([a-zA-Z]+)/.exec(src.slice(i));
      if (m) {
        i += m[0].length;
        const name = m[1];
        if (name === 'frac') return { t: 'frac', num: group(), den: group() };
        if (name === 'sqrt') return { t: 'sqrt', body: group() };
        if (NARY_CHARS[name]) return { t: 'nary', chr: NARY_CHARS[name] };
        if (TEX_MATH_SYMS[name]) return { t: 'run', s: TEX_MATH_SYMS[name] };
        if (name === 'left' || name === 'right') return { t: 'run', s: '' };
        return { t: 'run', s: name };
      }
      i += 2;
      return { t: 'run', s: src[i - 1] || '' };
    }
    return { t: 'run', s: src[i++] };
  }
  function seq(stop) {
    const nodes = [];
    while (i < src.length && src[i] !== stop) {
      if (src[i] === '^' || src[i] === '_') {
        const isSup = src[i] === '^';
        i++;
        const arg = group();
        const base = nodes.pop() || { t: 'run', s: '' };
        if (base.t === 'nary' || base.t === 'script') { base[isSup ? 'sup' : 'sub'] = arg; nodes.push(base); }
        else nodes.push({ t: 'script', base: [base], [isSup ? 'sup' : 'sub']: arg });
        continue;
      }
      if (src[i] === ' ') { i++; continue; }
      if (src[i] === '{') nodes.push(...group());
      else nodes.push(atom());
    }
    return nodes;
  }
  return seq(undefined);
}

function ommlOf(nodes) {
  const run = s => s ? `<m:r><m:t xml:space="preserve">${esc(s)}</m:t></m:r>` : '';
  let xml = '', buf = '';
  const flush = () => { xml += run(buf); buf = ''; };
  for (const n of nodes || []) {
    if (n.t === 'run') { buf += n.s; continue; }
    flush();
    if (n.t === 'frac') xml += `<m:f><m:num>${ommlOf(n.num)}</m:num><m:den>${ommlOf(n.den)}</m:den></m:f>`;
    else if (n.t === 'sqrt') xml += `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${ommlOf(n.body)}</m:e></m:rad>`;
    else if (n.t === 'script') {
      const tag = n.sup && n.sub ? 'sSubSup' : n.sup ? 'sSup' : 'sSub';
      xml += `<m:${tag}><m:e>${ommlOf(n.base)}</m:e>` +
        (n.sub ? `<m:sub>${ommlOf(n.sub)}</m:sub>` : '') +
        (n.sup ? `<m:sup>${ommlOf(n.sup)}</m:sup>` : '') + `</m:${tag}>`;
    } else if (n.t === 'nary')
      xml += `<m:nary><m:naryPr><m:chr m:val="${n.chr}"/><m:limLoc m:val="undOvr"/></m:naryPr><m:sub>${ommlOf(n.sub)}</m:sub><m:sup>${ommlOf(n.sup)}</m:sup><m:e/></m:nary>`;
  }
  flush();
  return xml;
}

function ommlFromTex(tex) {
  return `<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${ommlOf(parseTexMath(tex))}</m:oMath>`;
}

function texFromOmml(el) {
  const L = n => n.localName;
  const kids = n => [...n.children];
  const one = n => n ? texFromOmml(n) : '';
  const byName = (n, name) => kids(n).find(c => L(c) === name);
  switch (L(el)) {
    case 't': return stripCtl(el.textContent).split('').map(ch => SYM_TO_TEX[ch] || ch).join('');
    case 'f': return `\\frac{${one(byName(el, 'num'))}}{${one(byName(el, 'den'))}}`;
    case 'sSup': return `${one(byName(el, 'e'))}^{${one(byName(el, 'sup'))}}`;
    case 'sSub': return `${one(byName(el, 'e'))}_{${one(byName(el, 'sub'))}}`;
    case 'sSubSup': return `${one(byName(el, 'e'))}_{${one(byName(el, 'sub'))}}^{${one(byName(el, 'sup'))}}`;
    case 'rad': return `\\sqrt{${one(byName(el, 'e'))}}`;
    case 'nary': {
      const pr = byName(el, 'naryPr');
      const chrEl = pr && byName(pr, 'chr');
      const chr = chrEl ? (chrEl.getAttribute('m:val') || chrEl.getAttribute('val')) : '∫';
      const cmd = Object.entries(NARY_CHARS).find(([k, v]) => v === chr);
      return `\\${cmd ? cmd[0] : 'int'}_{${one(byName(el, 'sub'))}}^{${one(byName(el, 'sup'))}} ${one(byName(el, 'e'))}`;
    }
    case 'd': return `\\left(${kids(el).filter(c => L(c) === 'e').map(texFromOmml).join(',')}\\right)`;
    default: return kids(el).map(texFromOmml).join('');
  }
}

/* --- Word → LaTeX direct reader (headings, bold/italic, tables, OMML equations) --- */
async function docxToTex(file) {
  const zip = await JSZip.loadAsync(file.blob);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('Not a valid DOCX file');
  const xml = new DOMParser().parseFromString(await docFile.async('string'), 'application/xml');
  const L = n => n.localName;
  const body = xml.getElementsByTagName('w:body')[0];
  if (!body) throw new Error('Empty DOCX');
  // relationship map so embedded pictures can be exported as media/ files
  const rels = {};
  const relsFile = zip.file('word/_rels/document.xml.rels');
  if (relsFile) {
    const rx = new DOMParser().parseFromString(await relsFile.async('string'), 'application/xml');
    [...rx.getElementsByTagName('Relationship')].forEach(r => rels[r.getAttribute('Id')] = r.getAttribute('Target'));
  }
  const images = [];
  const imgTexFor = async rid => {
    const t = rels[rid];
    if (!t) return '';
    const f2 = zip.file('word/' + t.replace(/^\//, ''));
    if (!f2) return '';
    const ext = t.split('.').pop().toLowerCase();
    if (!['png', 'jpg', 'jpeg', 'gif', 'bmp'].includes(ext)) return ''; // emf/wmf unsupported
    const name = `image${images.length + 1}.${ext === 'jpeg' ? 'jpg' : ext}`;
    images.push({ name, u8: await f2.async('uint8array') });
    return `\\begin{figure}[h]\n\\centering\n\\includegraphics[width=0.8\\linewidth]{media/${name}}\n\\end{figure}\n\n`;
  };
  let out = TEX_PREAMBLE;
  let inList = false;
  const closeL = () => { if (inList) { out += '\\end{itemize}\n\n'; inList = false; } };
  const paraTex = p => {
    let s = '';
    for (const node of [...p.children]) {
      if (L(node) === 'r') {
        const t = [...node.getElementsByTagName('w:t')].map(x => x.textContent).join('');
        if (!t) continue;
        const rPr = [...node.children].find(c => L(c) === 'rPr');
        let piece = texEsc(t);
        if (rPr && [...rPr.children].some(c => L(c) === 'i')) piece = `\\textit{${piece}}`;
        if (rPr && [...rPr.children].some(c => L(c) === 'b')) piece = `\\textbf{${piece}}`;
        s += piece;
      } else if (L(node) === 'oMath') s += `$${texFromOmml(node)}$`;
      else if (L(node) === 'oMathPara')
        s += [...node.children].filter(c => L(c) === 'oMath').map(m => `$${texFromOmml(m)}$`).join(' ');
    }
    return s;
  };
  for (const el of [...body.children]) {
    if (L(el) === 'p') {
      const style = (el.getElementsByTagName('w:pStyle')[0] || { getAttribute: () => '' }).getAttribute('w:val') || '';
      const rids = [...el.getElementsByTagName('a:blip')]
        .map(b => b.getAttribute('r:embed') || b.getAttribute('embed')).filter(Boolean);
      for (const rid of rids) out += await imgTexFor(rid);
      const txt = paraTex(el);
      if (!txt.trim()) continue;
      const plain = txt.replace(/\\text(bf|it)\{([^}]*)\}/g, '$2');
      const szEl = el.getElementsByTagName('w:sz')[0];
      const half = szEl ? +szEl.getAttribute('w:val') : 0;
      const isBullet = el.getElementsByTagName('w:numPr').length > 0 ||
        /^[•▪◦]\s?/.test(el.textContent.trim());
      if (/heading\s*1|^h1$/i.test(style) || half >= 52) { closeL(); out += `\\section{${plain}}\n\n`; }
      else if (/heading\s*2/i.test(style) || half >= 40) { closeL(); out += `\\subsection{${plain}}\n\n`; }
      else if (/heading/i.test(style) || half >= 30) { closeL(); out += `\\subsubsection{${plain}}\n\n`; }
      else if (isBullet) {
        if (!inList) { out += '\\begin{itemize}\n'; inList = true; }
        out += `  \\item ${txt.replace(/^(\\textbullet\{\}\s*|[•▪◦]\s*|\d+\.\s+)/, '')}\n`;
      }
      else { closeL(); out += txt + '\n\n'; }
    } else if (L(el) === 'tbl') {
      closeL();
      const rows = [...el.getElementsByTagName('w:tr')].map(tr =>
        [...tr.getElementsByTagName('w:tc')].map(tc => texEsc(tc.textContent.trim())));
      const cols = Math.max(1, ...rows.map(r => r.length));
      out += `\\begin{tabular}{|${'l|'.repeat(cols)}}\n\\hline\n` +
        rows.map(r => r.join(' & ') + ' \\\\ \\hline').join('\n') + '\n\\end{tabular}\n\n';
    }
  }
  closeL();
  return { tex: out + '\\end{document}\n', images };
}

/* --- BibTeX ↔ IEEE references --- */
function parseBib(src) {
  const entries = [];
  const re = /@(\w+)\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const type = m[1].toLowerCase();
    if (['comment', 'preamble', 'string'].includes(type)) continue;
    let i = re.lastIndex, depth = 1;
    const start = i;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    const bodyStr = src.slice(start, i - 1);
    re.lastIndex = i;
    const comma = bodyStr.indexOf(',');
    const entry = { type, key: bodyStr.slice(0, comma < 0 ? bodyStr.length : comma).trim() };
    let rest = comma < 0 ? '' : bodyStr.slice(comma + 1);
    const fre = /([\w-]+)\s*=\s*/g;
    let fm;
    while ((fm = fre.exec(rest))) {
      let j = fre.lastIndex, val = '';
      if (rest[j] === '{') {
        let d = 1; j++;
        const s0 = j;
        while (j < rest.length && d > 0) { if (rest[j] === '{') d++; else if (rest[j] === '}') d--; j++; }
        val = rest.slice(s0, j - 1);
      } else if (rest[j] === '"') {
        const s0 = ++j;
        while (j < rest.length && rest[j] !== '"') j++;
        val = rest.slice(s0, j++);
      } else {
        const s0 = j;
        while (j < rest.length && rest[j] !== ',' && rest[j] !== '\n') j++;
        val = rest.slice(s0, j);
      }
      entry[fm[1].toLowerCase()] = val.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
      fre.lastIndex = j;
    }
    entries.push(entry);
  }
  return entries;
}

function ieeeAuthors(a) {
  return (a || '').split(/\s+and\s+/i).map(name => {
    name = name.trim();
    if (!name) return '';
    if (name.includes(',')) {
      const [last, first] = name.split(',').map(s => s.trim());
      return first ? first.split(/\s+/).map(p => p[0].toUpperCase() + '.').join(' ') + ' ' + last : last;
    }
    const parts = name.split(/\s+/);
    const last = parts.pop();
    return parts.map(p => p[0].toUpperCase() + '.').join(' ') + (parts.length ? ' ' : '') + last;
  }).filter(Boolean).join(', ');
}

function ieeeOf(e, i) {
  const A = ieeeAuthors(e.author || e.editor || '');
  const yr = e.year ? `, ${e.year}` : '';
  if (e.type === 'inproceedings' || e.type === 'conference')
    return `[${i}] ${A}, "${e.title || ''}," in Proc. ${e.booktitle || ''}${yr}${e.pages ? ', pp. ' + e.pages.replace('--', '–') : ''}.`;
  if (e.type === 'book')
    return `[${i}] ${A}, ${e.title || ''}. ${e.publisher || ''}${yr}.`;
  return `[${i}] ${A}, "${e.title || ''}," ${e.journal || e.howpublished || ''}${e.volume ? ', vol. ' + e.volume : ''}${e.number ? ', no. ' + e.number : ''}${e.pages ? ', pp. ' + e.pages.replace('--', '–') : ''}${yr}.`;
}

function parseIeeeRefs(text) {
  const numbered = text.split(/\n?\s*\[\d+\]\s*/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const refs = numbered.length ? numbered : text.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const entries = [];
  refs.forEach((r, idx) => {
    const e = {};
    const tm = /[“"]([^”"]+)[”"]/.exec(r);
    if (tm) e.title = tm[1].replace(/[,.]\s*$/, '');
    const authorsPart = (tm ? r.slice(0, tm.index) : r.split(',')[0]).replace(/,\s*$/, '').trim();
    e.author = authorsPart.split(/,\s*(?:and\s+)?|\s+and\s+/i).map(s => s.trim()).filter(Boolean).join(' and ');
    const after = tm ? r.slice(tm.index + tm[0].length) : r;
    const vol = /vol\.\s*([\w\d]+)/i.exec(after); if (vol) e.volume = vol[1];
    const no = /no\.\s*([\w\d]+)/i.exec(after); if (no) e.number = no[1];
    const pp = /pp\.\s*(\d+\s*[-–—]\s*\d+|\d+)/i.exec(after); if (pp) e.pages = pp[1].replace(/\s/g, '').replace(/[-–—]/, '--');
    const yr = /\b(19|20)\d{2}\b/.exec(after); if (yr) e.year = yr[0];
    if (/in\s+Proc|Proceedings|Conf\./i.test(after)) {
      e.type = 'inproceedings';
      const bt = /in\s+(?:Proc\.?\s*)?([^,]+)/i.exec(after);
      if (bt) e.booktitle = bt[1].trim();
    } else {
      e.type = 'article';
      const jm = /^\s*,?\s*([^,]+?)\s*,\s*(?:vol\.|no\.|pp\.|(?:19|20)\d{2})/i.exec(after);
      if (jm) e.journal = jm[1].trim();
    }
    const lastName = ((e.author.split(/\s+and\s+/)[0] || 'ref').trim().split(/\s+/).pop() || 'ref').replace(/[^A-Za-z]/g, '') || 'ref';
    e.key = lastName.toLowerCase() + (e.year || '') + (refs.length > 1 ? String.fromCharCode(97 + (idx % 26)) : '');
    if (e.title || e.author) entries.push(e);
  });
  if (!entries.length) throw new Error('No references recognized — expected IEEE-style entries like [1] A. Author, "Title," Journal, vol. 1, 2020.');
  return entries;
}

function bibOf(entries) {
  return entries.map(e => {
    const skip = new Set(['type', 'key']);
    const fields = Object.entries(e).filter(([k, v]) => !skip.has(k) && v)
      .map(([k, v]) => `  ${k} = {${v}}`).join(',\n');
    return `@${e.type || 'misc'}{${e.key || 'ref'},\n${fields}\n}`;
  }).join('\n\n') + '\n';
}

/* --- visual search (Google-Lens style): perceptual dHash similarity --- */
function dHash(canvas) {
  const c = document.createElement('canvas');
  c.width = 9; c.height = 8;
  const x = c.getContext('2d');
  x.drawImage(canvas, 0, 0, 9, 8);
  const d = x.getImageData(0, 0, 9, 8).data;
  const g = [];
  for (let i = 0; i < 72; i++) g.push(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]);
  let bits = '';
  for (let r = 0; r < 8; r++)
    for (let col = 0; col < 8; col++) bits += g[r * 9 + col] < g[r * 9 + col + 1] ? '1' : '0';
  return bits;
}

const hamming = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };

async function visualSearch(f) {
  $('#modal').classList.remove('hidden');
  $('#modalTitle').textContent = `🔎 Visual search — ${f.name}`;
  $('#paneLeftHead').textContent = 'Query image';
  $('#paneRightHead').textContent = 'Similar images & web search';
  const left = $('#paneLeft'), right = $('#paneRight');
  left.innerHTML = '';
  right.className = 'pane-body dark';
  right.innerHTML = '<pre style="color:#9aa3d0">Analyzing…</pre>';
  try {
    left.appendChild(await buildPreview(f));
    const c = await fileToCanvas(f);
    const qh = dHash(c);
    const results = [];
    for (const o of [...state.files, ...state.mergeFiles]) {
      if (o === f || FORMATS[o.fmt].kind !== 'image') continue;
      try { results.push({ o, sim: Math.round((1 - hamming(qh, dHash(await fileToCanvas(o))) / 64) * 100) }); }
      catch { /* skip unreadable */ }
    }
    results.sort((a, b) => b.sim - a.sim);
    const box = document.createElement('div');
    box.style.cssText = 'padding:16px;color:#e8ebff;font-size:13.5px';
    box.innerHTML = (results.length
      ? '<p style="color:#9aa3d0">Perceptual similarity against your other loaded images:</p>' +
        results.map(r =>
          `<p>📷 ${esc(r.o.name)} — <b style="color:${r.sim >= 80 ? '#34d399' : r.sim >= 55 ? '#fbbf24' : '#f87171'}">${r.sim}% similar</b></p>`).join('')
      : '<p style="color:#9aa3d0">No other images loaded to compare against — add more image files to the Convert tab, or use the web search below.</p>') +
      '<p style="color:#9aa3d0;margin-top:18px">Web search:</p>';
    const btns = document.createElement('p');
    const mkBtn = (label, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.marginRight = '8px';
      b.onclick = fn;
      btns.appendChild(b);
    };
    mkBtn('🌐 Search extracted text on Google', async () => {
      toast('Running OCR…');
      const t = (await ocrCanvas(whiteBacked(c))).slice(0, 120).replace(/\s+/g, ' ').trim();
      if (!t) { toast('No text found in the image', true); return; }
      window.open('https://www.google.com/search?q=' + encodeURIComponent(t), '_blank');
    });
    mkBtn('🔍 Open Google Lens', () => window.open('https://lens.google.com/', '_blank'));
    box.appendChild(btns);
    right.innerHTML = '';
    right.appendChild(box);
  } catch (e) {
    right.innerHTML = `<pre style="color:#f87171">Search failed: ${esc(e.message)}</pre>`;
  }
}

/* --- PDF writer (jsPDF, with pagination, headings, lists, tables, images) --- */
const PDF_SIZES = { h1: 24, h2: 19, h3: 16, h4: 14, h5: 12.5, h6: 12, p: 11, li: 11, pre: 9.5 };

async function docToPdf(html) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const M = 56, W = doc.internal.pageSize.getWidth() - 2 * M, H = doc.internal.pageSize.getHeight();
  let y = M;
  const need = h => { if (y + h > H - M) { doc.addPage(); y = M; } };
  const blocks = htmlToBlocks(html);
  for (const b of blocks) {
    if (b.type === 'img' || (b.runs || []).some(r => r.img)) {
      const src = b.type === 'img' ? b.src : b.runs.find(r => r.img).img;
      if (src && src.startsWith('data:image/')) {
        try {
          const img = new Image();
          await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = src; });
          const w = Math.min(W, img.naturalWidth * 0.75);
          const h = w * img.naturalHeight / img.naturalWidth;
          need(h + 10);
          doc.addImage(src, src.includes('png') ? 'PNG' : 'JPEG', M, y, w, h);
          y += h + 10;
        } catch { /* skip unreadable image */ }
      }
      if (b.type === 'img') continue;
    }
    if (b.type === 'table') {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
      for (const row of b.rows) {
        const lines = doc.splitTextToSize(row.map(pdfText).join('  |  '), W);
        need(lines.length * 12 + 2);
        doc.text(lines, M, y + 9);
        y += lines.length * 12 + 2;
      }
      y += 8;
      continue;
    }
    const sz = PDF_SIZES[b.type] || 11;
    const isHead = /^h[1-6]$/.test(b.type);
    const text = (b.type === 'li' ? (b.ordered ? `${b.index}. ` : '•  ') : '') +
      pdfText((b.runs || []).map(r => r.text || '').join(''));
    if (!text.trim()) { y += 6; continue; }
    doc.setFont(b.type === 'pre' ? 'courier' : 'helvetica', isHead ? 'bold' : 'normal');
    doc.setFontSize(sz);
    const lines = doc.splitTextToSize(text, W - (b.type === 'li' ? 14 : 0));
    const lh = sz * 1.45;
    if (isHead) { need(lh + 8); y += 8; }
    for (const line of lines) {
      need(lh);
      doc.text(line, M + (b.type === 'li' ? 14 : 0), y + sz);
      y += lh;
    }
    y += isHead ? 6 : 5;
  }
  return doc.output('blob');
}

/* doc IR → any doc output */
async function fromDoc(docIR, target, title = 'Document') {
  switch (target) {
    case 'txt':  return makeBlob(docIR.text, 'txt');
    case 'md':   return makeBlob(new TurndownService({ headingStyle: 'atx' }).turndown(docIR.html), 'md');
    case 'html': return makeBlob(fullHtml(docIR.html, title), 'html');
    case 'rtf':  return makeBlob(textToRtf(docIR.text), 'rtf');
    case 'docx': return buildDocx(docIR.html);
    case 'pdf':  return docToPdf(docIR.html);
    case 'pptx': return buildPptx(docIR.html, title);
    case 'tex':  return makeBlob(stripCtl((await texFromDoc(docIR.html)).tex), 'tex');
    case 'epub': return buildEpub(docIR.html, title);
    default: throw new Error(`No document renderer for ${target}`);
  }
}

/* table IR → any table/doc output */
async function fromTable(aoa, target, title) {
  const ws = () => XLSX.utils.aoa_to_sheet(aoa);
  switch (target) {
    case 'csv': return makeBlob(XLSX.utils.sheet_to_csv(ws()), 'csv');
    case 'tsv': return makeBlob(XLSX.utils.sheet_to_csv(ws(), { FS: '\t' }), 'tsv');
    case 'xlsx': {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws(), 'Sheet1');
      return makeBlob(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), 'xlsx');
    }
    case 'json': {
      const [head, ...rows] = aoa.length ? aoa : [[]];
      const objs = rows.map(r => Object.fromEntries(head.map((h, i) => [String(h || `col${i + 1}`), r[i] ?? ''])));
      return makeBlob(JSON.stringify(objs, null, 2), 'json');
    }
    case 'xml': {
      const [head, ...rows] = aoa.length ? aoa : [[]];
      const tag = s => String(s || 'col').replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1');
      const body = rows.map(r =>
        `  <row>${head.map((h, i) => `<${tag(h)}>${esc(r[i] ?? '')}</${tag(h)}>`).join('')}</row>`).join('\n');
      return makeBlob(`<?xml version="1.0" encoding="UTF-8"?>\n<rows>\n${body}\n</rows>`, 'xml');
    }
    case 'arff': {
      const [head, ...rows] = aoa.length ? aoa : [[]];
      const isNum = i => rows.length && rows.every(r => r[i] === '' || r[i] == null || (r[i] !== '' && isFinite(r[i])));
      const attrs = head.map((h, i) =>
        `@attribute '${String(h).replace(/'/g, '_')}' ${isNum(i) ? 'numeric' : 'string'}`).join('\n');
      const data = rows.map(r => head.map((h, i) => {
        const v = r[i] ?? '';
        return v !== '' && isFinite(v) ? v : `'${String(v).replace(/'/g, "\\'")}'`;
      }).join(',')).join('\n');
      return makeBlob(`@relation '${String(title || 'dataset').replace(/'/g, '_')}'\n\n${attrs}\n\n@data\n${data}\n`, 'arff');
    }
    case 'mlab': {
      const [head, ...rows] = aoa.length ? aoa : [[]];
      const allNum = rows.length && rows.every(r => r.every(v => v === '' || v == null || isFinite(v)));
      let m = `% Dataset exported by OmniConvert — load with: run('${(title || 'data')}.m')\n`;
      m += `headers = {${head.map(h => `'${String(h).replace(/'/g, "''")}'`).join(', ')}};\n`;
      if (allNum)
        m += `data = [\n${rows.map(r => '  ' + head.map((h, i) => (r[i] === '' || r[i] == null) ? 'NaN' : r[i]).join(', ')).join(';\n')}\n];\n` +
             `T = array2table(data, 'VariableNames', matlab.lang.makeValidName(headers));\n`;
      else
        m += `data = {\n${rows.map(r => '  ' + head.map((h, i) => {
          const v = r[i] ?? '';
          return v !== '' && isFinite(v) ? v : `'${String(v).replace(/'/g, "''")}'`;
        }).join(', ')).join(';\n')}\n};\n` +
             `T = cell2table(data, 'VariableNames', matlab.lang.makeValidName(headers));\n`;
      return makeBlob(m, 'mlab');
    }
    default:
      return fromDoc({ html: aoaToHtmlTable(aoa), text: aoaToText(aoa) }, target, title);
  }
}

/* --- image outputs --- */
function canvasToBlobP(canvas, mime, quality) {
  return new Promise((ok, bad) =>
    canvas.toBlob(b => b ? ok(b) : bad(new Error(`Encoder for ${mime} unavailable`)), mime, quality));
}

function whiteBacked(canvas) {
  const c = document.createElement('canvas');
  c.width = canvas.width; c.height = canvas.height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(canvas, 0, 0);
  return c;
}

function canvasToBmp(canvas) {
  const w = canvas.width, h = canvas.height;
  const d = whiteBacked(canvas).getContext('2d').getImageData(0, 0, w, h).data;
  const rowSize = Math.floor((24 * w + 31) / 32) * 4;
  const size = 54 + rowSize * h;
  const buf = new ArrayBuffer(size);
  const v = new DataView(buf);
  v.setUint8(0, 0x42); v.setUint8(1, 0x4D);
  v.setUint32(2, size, true); v.setUint32(10, 54, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, w, true); v.setInt32(22, -h, true); // top-down rows
  v.setUint16(26, 1, true); v.setUint16(28, 24, true);
  v.setUint32(34, rowSize * h, true);
  const pad = rowSize - w * 3;
  let off = 54;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      v.setUint8(off++, d[i + 2]); v.setUint8(off++, d[i + 1]); v.setUint8(off++, d[i]);
    }
    for (let p = 0; p < pad; p++) v.setUint8(off++, 0);
  }
  return new Blob([buf], { type: 'image/bmp' });
}

/* gif.js is loaded lazily (vendored, same-origin worker) */
let gifLibReady;
function ensureGifLib() {
  if (!gifLibReady) {
    gifLibReady = (async () => {
      await new Promise((ok, bad) => {
        const s = document.createElement('script');
        s.src = 'vendor/gif.min.js';
        s.onload = ok; s.onerror = () => bad(new Error('Could not load GIF encoder'));
        document.head.appendChild(s);
      });
      return 'vendor/gif.worker.js';
    })();
  }
  return gifLibReady;
}

async function canvasesToGif(canvases, delay = 125) {
  const workerScript = await ensureGifLib();
  return new Promise((ok, bad) => {
    const gif = new GIF({ workers: 2, quality: 10, workerScript,
      width: canvases[0].width, height: canvases[0].height });
    for (const c of canvases) gif.addFrame(whiteBacked(c), { delay });
    gif.on('finished', blob => ok(blob));
    gif.on('abort', () => bad(new Error('GIF encoding aborted')));
    gif.render();
  });
}

async function imageOut(canvas, target, quality = 0.92) {
  switch (target) {
    case 'png':  return canvasToBlobP(canvas, 'image/png');
    case 'jpeg': return canvasToBlobP(whiteBacked(canvas), 'image/jpeg', quality);
    case 'webp': return canvasToBlobP(canvas, 'image/webp', quality);
    case 'bmp':  return canvasToBmp(canvas);
    case 'gif':  return canvasesToGif([canvas]);
    case 'svg': {
      const data = canvas.toDataURL('image/png');
      return makeBlob(`<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}"><image width="${canvas.width}" height="${canvas.height}" xlink:href="${data}"/></svg>`, 'svg');
    }
    default: throw new Error(`No image encoder for ${target}`);
  }
}

async function canvasesToPdf(canvases) {
  const pdf = await PDFLib.PDFDocument.create();
  for (const c of canvases) {
    const img = await pdf.embedPng(c.toDataURL('image/png'));
    const w = c.width * 0.75, h = c.height * 0.75; // px → pt
    const page = pdf.addPage([w, h]);
    page.drawImage(img, { x: 0, y: 0, width: w, height: h });
  }
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}

/* --- audio outputs --- */
function audioToWav(buffer) {
  const ch = Math.min(2, buffer.numberOfChannels);
  const len = buffer.length, sr = buffer.sampleRate;
  const bytes = 44 + len * ch * 2;
  const buf = new ArrayBuffer(bytes);
  const v = new DataView(buf);
  const wstr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  wstr(0, 'RIFF'); v.setUint32(4, bytes - 8, true); wstr(8, 'WAVE');
  wstr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, ch, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  wstr(36, 'data'); v.setUint32(40, len * ch * 2, true);
  const chans = [];
  for (let c = 0; c < ch; c++) chans.push(buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++)
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      off += 2;
    }
  return new Blob([buf], { type: 'audio/wav' });
}

function audioToMp3(buffer) {
  if (typeof lamejs === 'undefined') throw new Error('MP3 encoder failed to load — try WAV instead');
  const ch = Math.min(2, buffer.numberOfChannels);
  const sr = buffer.sampleRate, len = buffer.length;
  const enc = new lamejs.Mp3Encoder(ch, sr, 128);
  const toInt16 = f32 => {
    const out = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return out;
  };
  const L = toInt16(buffer.getChannelData(0));
  const R = ch > 1 ? toInt16(buffer.getChannelData(1)) : null;
  const chunks = [];
  const CH = 1152;
  for (let i = 0; i < len; i += CH) {
    const d = ch > 1
      ? enc.encodeBuffer(L.subarray(i, i + CH), R.subarray(i, i + CH))
      : enc.encodeBuffer(L.subarray(i, i + CH));
    if (d.length) chunks.push(new Uint8Array(d));
  }
  const end = enc.flush();
  if (end.length) chunks.push(new Uint8Array(end));
  return new Blob(chunks, { type: 'audio/mpeg' });
}

/* ================= 5. The universal converter ================= */

/* convertOne(file, target) → array of output files
   (an array because e.g. a 5-page PDF → PNG yields 5 images) */
async function convertOne(file, target, opts = {}) {
  const quality = opts.quality ?? state.quality;
  const src = FORMATS[file.fmt], tgt = FORMATS[target];
  if (!src || !tgt) throw new Error('Unknown format');
  const sk = src.kind, tk = tgt.kind;
  const one = blob => [{ name: outName(file.name, target), blob, fmt: target }];

  // encryption / decryption (any format ↔ .enc)
  if (file.fmt === 'enc' || target === 'auto') return [await decryptFile(file, opts.password)];
  if (target === 'enc') return [await encryptFile(file, opts.password)];

  // PDF → images (one file per page)
  if (sk === 'pdf' && (tk === 'image')) {
    const canvases = await pdfToCanvases(file);
    if (target === 'gif' && canvases.length > 1)
      return one(await canvasesToGif(canvases.map(whiteBacked), 800));
    return Promise.all(canvases.map(async (c, i) => ({
      name: outName(file.name, target, canvases.length > 1 ? `-p${i + 1}` : ''),
      blob: await imageOut(c, target, quality),
      fmt: target,
    })));
  }

  // video sources
  if (sk === 'video') {
    if (target === 'mp4' || target === 'webm')
      return one(await transcodeVideo(file, target));
    if (target === 'wav' || target === 'mp3') {
      const buf = await decodeAudio(file);
      return one(target === 'wav' ? audioToWav(buf) : audioToMp3(buf));
    }
    const video = await loadVideo(file);
    try {
      if (target === 'png' || target === 'jpeg') {
        const c = await seekFrame(video, Math.min(0.1, video.duration || 0));
        return one(await imageOut(c, target, quality));
      }
      if (target === 'gif') {
        const fps = 8, dur = Math.min(video.duration || 3, 6);
        const frames = [];
        for (let t = 0; t < dur; t += 1 / fps) frames.push(await seekFrame(video, t, 480));
        return one(await canvasesToGif(frames, 1000 / fps));
      }
    } finally { URL.revokeObjectURL(video.src); }
  }

  // audio sources
  if (sk === 'audio') {
    const buf = await decodeAudio(file);
    return one(target === 'wav' ? audioToWav(buf) : audioToMp3(buf));
  }

  // image sources
  if (sk === 'image') {
    const c = await fileToCanvas(file);
    if (target === 'pdf') return one(await canvasesToPdf([c]));
    if (target === 'docx') return one(await buildDocx(`<img src="${c.toDataURL('image/png')}">`));
    if (tk === 'table') {
      // OCR word boxes → reconstructed grid (any size table in a picture)
      const aoa = await imageToTable(c);
      if (aoa && aoa.length) return one(await fromTable(aoa, target, baseName(file.name)));
      if (target === 'xlsx') return one(await xlsxWithImage(c)); // no text → embed the picture
      throw new Error('OCR found no table or text in this image');
    }
    if (['txt', 'md', 'html', 'rtf'].includes(target)) {
      // OCR the picture into editable text
      const t = await ocrCanvas(whiteBacked(c));
      if (!t) throw new Error('OCR found no readable text in this image');
      return one(await fromDoc({ html: textToHtml(t), text: t }, target, baseName(file.name)));
    }
    return one(await imageOut(c, target, quality));
  }

  // code sources (Python / MATLAB)
  if (sk === 'code') {
    const codeTxt = stripCtl(await file.blob.text());
    if (target === 'tex') return one(makeBlob(texFromCode(codeTxt, file.fmt), 'tex'));
    if (target === 'txt') return one(makeBlob(codeTxt, 'txt'));
    return one(await fromDoc({ html: highlightCode(codeTxt, file.fmt), text: codeTxt }, target, baseName(file.name)));
  }

  // BibTeX sources → IEEE reference list / structured data
  if (sk === 'ref') {
    const entries = parseBib(await file.blob.text());
    if (!entries.length) throw new Error('No BibTeX entries found');
    if (target === 'json') return one(makeBlob(JSON.stringify(entries, null, 2), 'json'));
    if (tk === 'table') {
      const heads = [...new Set(entries.flatMap(e => Object.keys(e)))];
      return one(await fromTable([heads, ...entries.map(e => heads.map(h => e[h] ?? ''))], target, baseName(file.name)));
    }
    const lines = entries.map((e, i) => ieeeOf(e, i + 1));
    return one(await fromDoc({ html: lines.map(l => `<p>${esc(l)}</p>`).join('\n'), text: lines.join('\n') }, target, baseName(file.name)));
  }

  // table sources
  if (sk === 'table') {
    const aoa = await toTable(file);
    return one(await fromTable(aoa, target, baseName(file.name)));
  }

  // PDF → structured table data (text layer if present, OCR boxes if scanned)
  if (sk === 'pdf' && tk === 'table') {
    const aoa = await pdfToTable(file);
    return one(await fromTable(aoa, target, baseName(file.name)));
  }

  // plain text → BibTeX (IEEE-style references) or dataset
  if (target === 'bib')
    return one(makeBlob(bibOf(parseIeeeRefs(await file.blob.text())), 'bib'));
  if (sk === 'doc' && tk === 'table')
    return one(await fromTable(txtToTable(await file.blob.text()), target, baseName(file.name)));

  // PowerPoint → PDF as real slides (16:9 landscape, one page per slide)
  if (file.fmt === 'pptx' && target === 'pdf')
    return one(await pptxToPdf(file));

  // any document → LaTeX: Word keeps native equations, PowerPoint becomes
  // beamer, and embedded pictures ship as media/ files beside the .tex
  if (target === 'tex') {
    let r;
    if (file.fmt === 'docx') r = await docxToTex(file);
    else if (file.fmt === 'pptx') r = await buildBeamer((await toDoc(file)).html, baseName(file.name));
    else r = await texFromDoc((await toDoc(file)).html);
    return texResult(file, r.tex, r.images);
  }

  // doc + pdf sources → doc outputs
  const docIR = await toDoc(file);
  return one(await fromDoc(docIR, target, baseName(file.name)));
}

/* ================= 6. Previews ================= */

async function buildPreview(file) {
  const kind = FORMATS[file.fmt]?.kind;
  if (file.fmt === 'enc') {
    const pre = document.createElement('pre');
    pre.textContent = '🔐 AES-256 encrypted file — convert it with “Decrypt to original” to restore the content.';
    return pre;
  }
  if (file.fmt === 'zip') {
    const pre = document.createElement('pre');
    pre.textContent = '📦 ZIP archive — the .tex document plus its media/ images. Unzip, then compile with pdflatex.';
    return pre;
  }
  const url = URL.createObjectURL(file.blob);
  if (file.fmt === 'pdf') {
    const f = document.createElement('iframe');
    f.src = url;
    return f;
  }
  if (kind === 'image') {
    if (file.fmt === 'svg') {
      const f = document.createElement('iframe');
      f.src = url;
      return f;
    }
    const img = document.createElement('img');
    img.src = url;
    return img;
  }
  if (kind === 'audio') {
    const a = document.createElement('audio');
    a.controls = true; a.src = url;
    return a;
  }
  if (kind === 'video') {
    const v = document.createElement('video');
    v.controls = true; v.src = url;
    return v;
  }
  if (kind === 'table') {
    try {
      const aoa = await toTable(file);
      const div = document.createElement('div');
      div.innerHTML = aoaToHtmlTable(aoa.slice(0, 300));
      return div;
    } catch {
      const pre = document.createElement('pre');
      pre.textContent = await file.blob.text();
      return pre;
    }
  }
  if (file.fmt === 'txt' || file.fmt === 'rtf') {
    const pre = document.createElement('pre');
    pre.textContent = file.fmt === 'rtf' ? rtfToText(await file.blob.text()) : await file.blob.text();
    return pre;
  }
  // md / html / docx → rendered document
  try {
    const docIR = await toDoc(file);
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', '');
    f.srcdoc = fullHtml(docIR.html, file.name);
    return f;
  } catch {
    const pre = document.createElement('pre');
    pre.textContent = '(no preview available)';
    return pre;
  }
}

async function openCompare(original, converted) {
  $('#modal').classList.remove('hidden');
  $('#modalTitle').textContent = `${original.name} → ${converted.name}`;
  $('#paneLeftHead').textContent = `Original · ${FORMATS[original.fmt].label} · ${fmtSize(original.blob.size)}`;
  $('#paneRightHead').textContent = `Converted · ${FORMATS[converted.fmt].label} · ${fmtSize(converted.blob.size)}`;
  $('#paneRight').className = 'pane-body';
  for (const [sel, f] of [['#paneLeft', original], ['#paneRight', converted]]) {
    const pane = $(sel);
    pane.innerHTML = '<pre>Loading…</pre>';
    try {
      const el = await buildPreview(f);
      pane.innerHTML = '';
      pane.appendChild(el);
    } catch (e) {
      pane.innerHTML = `<pre>Preview failed: ${esc(e.message)}</pre>`;
    }
  }
}

/* ================= 7. UI state & wiring ================= */

const state = {
  files: [],       // convert tab inputs
  mergeFiles: [],
  quality: 0.92,
  pdfTool: null,   // { bytes, pages:[{index, rot, del, selected}] }
};

/* ---- tabs ---- */
$('#tabs').addEventListener('click', e => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  $$('.tab').forEach(t => t.classList.toggle('active', t === btn));
  $$('.tabpane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab));
});

/* ---- generic dropzone helper ---- */
function wireDrop(zoneSel, inputSel, onFiles) {
  const zone = $(zoneSel), input = $(inputSel);
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { onFiles([...input.files]); input.value = ''; });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('over');
    onFiles([...e.dataTransfer.files]);
  });
}

function ingest(rawFiles) {
  const out = [];
  for (const f of rawFiles) {
    const fmt = detectFmt(f.name, f.type);
    if (!fmt) { toast(`Unsupported file type: ${f.name}`, true); continue; }
    out.push({ name: f.name, blob: f, fmt });
  }
  return out;
}

/* ---- one-click workflows (the verified task list, as visible buttons) ---- */
const SAMPLE_EQ = '# Equation demo\n\nMass–energy: $E=mc^2$\n\nFraction: $\\frac{a+b}{c}$\n\nSum: $\\sum_{i=1}^{n} i^2$\n\nOpen the result in Word — these are native, editable equations.';

const WORKFLOWS = [
  { ico: '📘', title: 'Word → LaTeX',      desc: 'Headings, bold, tables & native equations → .tex', src: ['docx'], target: 'tex',  accept: '.docx' },
  { ico: '📜', title: 'LaTeX → Word',      desc: '.tex back to .docx — equations become Word math',  src: ['tex'],  target: 'docx', accept: '.tex' },
  { ico: '📙', title: 'PPTX → Beamer',     desc: 'Slides → \\begin{frame} beamer deck',              src: ['pptx'], target: 'tex',  accept: '.pptx' },
  { ico: '🎞️', title: 'Beamer → PPTX',     desc: 'Beamer .tex back to PowerPoint slides',            src: ['tex'],  target: 'pptx', accept: '.tex' },
  { ico: '🐍', title: 'Code → LaTeX',      desc: 'Python / MATLAB → listings with highlighting',     src: ['py', 'mcode'], target: 'tex', accept: '.py,.m' },
  { ico: '➗', title: 'Equation sample',   desc: 'Demo: $E=mc^2$ → real editable Word math',         sample: true },
  { ico: '📕', title: 'PDF → LaTeX',       desc: 'Any size — headings restored, OCR for scans',      src: ['pdf'], target: 'tex', accept: '.pdf' },
  { ico: '📝', title: 'PDF → Markdown',    desc: 'Token-saving MD with structure kept',              src: ['pdf'], target: 'md',  accept: '.pdf' },
  { ico: '🧪', title: 'Data → ARFF',       desc: 'CSV / XLSX / TXT → Weka with typed attributes',    srcKind: 'table', srcExtra: ['txt'], target: 'arff', accept: '.csv,.tsv,.xlsx,.txt,.json,.xml' },
  { ico: '📈', title: 'Data → MATLAB',     desc: 'CSV / XLSX → .m script (array2table ready)',       srcKind: 'table', srcExtra: ['txt'], target: 'mlab', accept: '.csv,.tsv,.xlsx,.txt' },
  { ico: '🖼️', title: 'Table image → CSV', desc: 'Photograph/scan of a table → OCR grid → CSV',      srcKind: 'image', target: 'csv', accept: 'image/*' },
  { ico: '🔖', title: 'IEEE → BibTeX',     desc: '.txt with [1]-style references → .bib entries',    src: ['txt'], target: 'bib', accept: '.txt' },
  { ico: '📚', title: 'BibTeX → IEEE',     desc: '.bib → numbered IEEE reference list',              src: ['bib'], target: 'txt', accept: '.bib' },
  { ico: '🗜', title: 'Compress a PDF',    desc: 'Shrink huge/scanned PDFs, e.g. 80 MB → ~10 MB',    tab: 'pdftools' },
  { ico: '✏️', title: 'Edit a PDF',        desc: 'Annotate, whiteout, split, rotate, reorder pages', tab: 'pdftools' },
  { ico: '🎨', title: 'Edit an image',     desc: 'Crop, draw, text, whiteout, brightness/contrast',  tab: 'studio' },
  { ico: '🔎', title: 'Visual search',     desc: 'Lens-style: rank similar images, search the web',  lens: true },
  { ico: '🤖', title: 'AI assistant',      desc: 'Agent, RAG document Q&A, summarize & translate',   tab: 'ai' },
];

function wfMatches(wf) {
  return state.files.filter(f =>
    (wf.src && wf.src.includes(f.fmt)) ||
    (wf.srcKind && FORMATS[f.fmt].kind === wf.srcKind) ||
    (wf.srcExtra && wf.srcExtra.includes(f.fmt)));
}

function applyWorkflow(wf) {
  if (wf.lens) {
    const img = state.files.find(f => FORMATS[f.fmt].kind === 'image');
    if (img) visualSearch(img);
    else toast('Add an image first, then click Visual search', true);
    return;
  }
  if (!wfMatches(wf).length) {
    toast(`No matching file loaded for “${wf.title}” (expected: ${(wf.src || [wf.srcKind]).join(', ')})`, true);
    return;
  }
  state.wfOnly = wfMatches(wf);
  rebuildPipeline([wf.target]);
  $('#convertBtn').click();
}

function runWorkflow(wf) {
  if (wf.tab) {
    $$('.tab').find(t => t.dataset.tab === wf.tab).click();
    return;
  }
  if (wf.sample) {
    state.files.push({ name: 'equation-sample.md', fmt: 'md', blob: new Blob([SAMPLE_EQ]) });
    renderFileList();
    rebuildPipeline(['docx']);
    $('#convertBtn').click();
    return;
  }
  if (wf.lens && state.files.some(f => FORMATS[f.fmt].kind === 'image')) { applyWorkflow(wf); return; }
  if (!wf.lens && wfMatches(wf).length) { applyWorkflow(wf); return; }
  // nothing suitable loaded yet → ask for the right file, then run automatically
  state.pendingWorkflow = wf;
  const inp = $('#fileInput');
  inp.accept = wf.accept || (wf.lens ? 'image/*' : '');
  inp.click();
  toast(`Pick a file for “${wf.title}”…`);
}

/* ---- convert tab ---- */
wireDrop('#dropConvert', '#fileInput', raw => {
  state.files.push(...ingest(raw));
  renderFileList();
  $('#fileInput').removeAttribute('accept');
  if (state.pendingWorkflow) {
    const wf = state.pendingWorkflow;
    state.pendingWorkflow = null;
    applyWorkflow(wf);
  }
});

$('#urlBtn').addEventListener('click', importUrl);
$('#urlInput').addEventListener('keydown', e => { if (e.key === 'Enter') importUrl(); });

async function importUrl() {
  const url = $('#urlInput').value.trim();
  if (!url) return;
  try {
    toast('Fetching…');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const name = decodeURIComponent(url.split('/').pop().split('?')[0]) || 'imported';
    const fmt = detectFmt(name, blob.type);
    if (!fmt) throw new Error('Could not detect the file format');
    state.files.push({ name, blob, fmt });
    $('#urlInput').value = '';
    renderFileList();
    toast(`Imported ${name}`);
  } catch (e) {
    toast(`URL import failed: ${e.message} (the server may block cross-origin requests)`, true);
  }
}

function fileRow(f, i, list, onRemove) {
  const row = document.createElement('div');
  row.className = 'file-row';
  row.innerHTML =
    `<span class="file-ico">${FORMATS[f.fmt].ico}</span>` +
    `<span class="file-name">${esc(f.name)}</span>` +
    `<span class="fmt-chip">${FORMATS[f.fmt].label}</span>` +
    `<span class="file-meta">${fmtSize(f.blob.size)}</span>` +
    `<span class="spacer"></span><span class="row-status"></span>`;
  if (FORMATS[f.fmt].kind === 'image') {
    const lens = document.createElement('button');
    lens.className = 'small';
    lens.textContent = '🔎';
    lens.title = 'Visual search — find similar images and search the web';
    lens.onclick = () => visualSearch(f);
    row.appendChild(lens);
  }
  const rm = document.createElement('button');
  rm.className = 'small danger'; rm.textContent = '✖';
  rm.onclick = () => { list.splice(i, 1); onRemove(); };
  row.appendChild(rm);
  return row;
}

function renderFileList() {
  const box = $('#fileList');
  box.innerHTML = '';
  state.files.forEach((f, i) => box.appendChild(fileRow(f, i, state.files, renderFileList)));
  $('#pipelineCard').classList.toggle('hidden', !state.files.length);
  if (state.files.length) rebuildPipeline();
  refreshAiFileSel();
}

/* ---- pipeline builder ---- */
function formatOptionsHtml(fmts, selected) {
  const groups = {};
  for (const f of fmts) (groups[FORMATS[f].group] ??= []).push(f);
  return Object.entries(groups).map(([g, list]) =>
    `<optgroup label="${g}">${list.map(f =>
      `<option value="${f}" ${f === selected ? 'selected' : ''}>${FORMATS[f].ico} ${FORMATS[f].label}</option>`
    ).join('')}</optgroup>`).join('');
}

function pipelineSteps() {
  return $$('#pipelineSteps select').map(s => s.value);
}

function rebuildPipeline(keep = null) {
  const steps = keep || (pipelineSteps().length ? pipelineSteps() : [null]);
  const box = $('#pipelineSteps');
  box.innerHTML = '';

  const srcFmts = [...new Set(state.files.map(f => f.fmt))];
  const srcChip = document.createElement('span');
  srcChip.className = 'pipe-src';
  srcChip.textContent = srcFmts.length
    ? srcFmts.map(f => FORMATS[f].label).join(' + ')
    : 'Source';
  box.appendChild(srcChip);

  let avail = srcFmts.length
    ? [...new Set(srcFmts.flatMap(targetsFor))]
    : Object.keys(FORMATS).filter(f => !FORMATS[f].inOnly);

  steps.forEach((val, i) => {
    const arrow = document.createElement('span');
    arrow.className = 'pipe-arrow';
    arrow.textContent = '➜';
    box.appendChild(arrow);

    const step = document.createElement('div');
    step.className = 'pipe-step';
    const sel = document.createElement('select');
    const selected = avail.includes(val) ? val : avail[0];
    sel.innerHTML = formatOptionsHtml(avail, selected);
    sel.addEventListener('change', () => rebuildPipeline(pipelineSteps()));
    step.appendChild(sel);
    if (i > 0) {
      const rm = document.createElement('button');
      rm.className = 'small danger'; rm.textContent = '✖';
      rm.onclick = () => {
        const s = pipelineSteps();
        s.splice(i, 1);
        rebuildPipeline(s);
      };
      step.appendChild(rm);
    }
    box.appendChild(step);
    avail = targetsFor(sel.value);
  });
}

$('#addStepBtn').addEventListener('click', () => {
  const s = pipelineSteps();
  const last = s[s.length - 1];
  const next = targetsFor(last)[0];
  if (!next) { toast('This format has no further conversion targets', true); return; }
  rebuildPipeline([...s, next]);
});

$('#qualitySlider').addEventListener('input', e => {
  state.quality = e.target.value / 100;
  $('#qualityVal').textContent = e.target.value + '%';
});

$('#aiBoostChk').addEventListener('change', e => {
  state.aiBoost = e.target.checked;
  localStorage.setItem('omni_ai_boost', state.aiBoost ? '1' : '');
  if (state.aiBoost && !AI.key)
    toast('AI boost needs an API key — add one in the 🤖 AI tab', true);
  else if (state.aiBoost)
    toast('AI boost ON — agents will clean OCR output, repair tables and retry failed conversions');
});

/* ---- run conversion ---- */
$('#convertBtn').addEventListener('click', async () => {
  if (!state.files.length) return;
  const steps = pipelineSteps();
  const btn = $('#convertBtn');
  btn.disabled = true;
  const status = $('#convertStatus');
  const rows = $$('#fileList .file-row');
  const only = state.wfOnly;
  state.wfOnly = null;
  let done = 0, failed = 0;
  const t0 = performance.now();
  for (let i = 0; i < state.files.length; i++) {
    const f = state.files[i];
    const st = rows[i]?.querySelector('.row-status');
    if (only && !only.includes(f)) {
      if (st) { st.textContent = '— skipped (not part of this workflow)'; st.className = 'row-status'; }
      continue;
    }
    if (st) { st.textContent = 'converting…'; st.className = 'row-status'; }
    status.textContent = `Converting ${i + 1} / ${state.files.length}: ${f.name}`;
    try {
      let currents = [f];
      for (const step of steps) {
        const next = [];
        for (const c of currents) {
          if (c.fmt === step) { next.push(c); continue; }
          if (!targetsFor(c.fmt).includes(step))
            throw new Error(`${FORMATS[c.fmt].label} → ${FORMATS[step].label} is not supported`);
          next.push(...await convertOne(c, step));
        }
        currents = next;
      }
      if (state.aiBoost && AI.key)
        currents = await aiBoostOutputs(f, currents, s => status.textContent = s);
      addResults('#resultsCard', '#resultList', currents, f);
      if (st) { st.textContent = `✔ ${currents.length} file${currents.length > 1 ? 's' : ''}`; st.className = 'row-status ok'; }
      done++;
    } catch (e) {
      // agentic auto-recovery: ask the LLM agent for an alternative route and retry
      let recovered = false;
      if (state.aiBoost && AI.key && steps.length === 1) {
        try {
          const via = await aiErrorFix(f, steps[0], e.message);
          if (via) {
            status.textContent = `🤖 Agent retrying ${f.name} via ${FORMATS[via].label}…`;
            const outs = [];
            for (const m of await convertOne(f, via)) outs.push(...await convertOne(m, steps[0]));
            addResults('#resultsCard', '#resultList', outs, f);
            if (st) { st.textContent = `✔ auto-fixed by agent (via ${FORMATS[via].label})`; st.className = 'row-status ok'; }
            done++;
            recovered = true;
          }
        } catch { /* recovery also failed — fall through to the normal error row */ }
      }
      if (!recovered) {
        console.error(e);
        if (st) { st.textContent = '✖ ' + e.message; st.className = 'row-status err'; }
        failed++;
      }
    }
  }
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  status.textContent = `Done: ${done} converted${failed ? `, ${failed} failed` : ''} in ${secs}s`;
  btn.disabled = false;
});

/* ---- results ---- */
function addResults(cardSel, listSel, outputs, original) {
  $(cardSel).classList.remove('hidden');
  const list = $(listSel);
  for (const out of outputs) {
    const row = document.createElement('div');
    row.className = 'result-row';
    row.innerHTML =
      `<span class="file-ico">${FORMATS[out.fmt].ico}</span>` +
      `<span class="file-name">${esc(out.name)}</span>` +
      `<span class="fmt-chip">${FORMATS[out.fmt].label}</span>` +
      `<span class="file-meta">${fmtSize(out.blob.size)}</span>` +
      `<span class="spacer"></span>`;
    const mk = (label, fn, cls = 'small') => {
      const b = document.createElement('button');
      b.className = cls; b.textContent = label; b.onclick = fn;
      row.appendChild(b);
    };
    mk('⬇ Download', () => download(out), 'small primary');
    if (original) mk('🔍 Compare', () => openCompare(original, out));
    else mk('🔍 Preview', () => openCompare(out, out));
    mk('↩ Re-input', () => {
      state.files.push(out);
      renderFileList();
      toast(`${out.name} added back as an input — chain another conversion`);
      $$('.tab').find(t => t.dataset.tab === 'convert').click();
    });
    list.prepend(row);
  }
}

/* ---- merge tab ---- */
wireDrop('#dropMerge', '#mergeInput', raw => {
  const ok = ingest(raw).filter(f => {
    const k = FORMATS[f.fmt].kind;
    if (k === 'audio' || k === 'video') { toast(`${f.name}: audio/video cannot be merged into a PDF`, true); return false; }
    return true;
  });
  state.mergeFiles.push(...ok);
  renderMergeList();
});

function renderMergeList() {
  const box = $('#mergeList');
  box.innerHTML = '';
  state.mergeFiles.forEach((f, i) => {
    const row = fileRow(f, i, state.mergeFiles, renderMergeList);
    const up = document.createElement('button');
    up.className = 'small'; up.textContent = '▲'; up.disabled = i === 0;
    up.onclick = () => { [state.mergeFiles[i - 1], state.mergeFiles[i]] = [state.mergeFiles[i], state.mergeFiles[i - 1]]; renderMergeList(); };
    const dn = document.createElement('button');
    dn.className = 'small'; dn.textContent = '▼'; dn.disabled = i === state.mergeFiles.length - 1;
    dn.onclick = () => { [state.mergeFiles[i + 1], state.mergeFiles[i]] = [state.mergeFiles[i], state.mergeFiles[i + 1]]; renderMergeList(); };
    row.insertBefore(dn, row.lastChild);
    row.insertBefore(up, dn);
    box.appendChild(row);
  });
  const btn = $('#mergeBtn');
  btn.classList.toggle('hidden', state.mergeFiles.length < 1);
  btn.textContent = `🧩 Merge ${state.mergeFiles.length} file${state.mergeFiles.length > 1 ? 's' : ''} into one PDF`;
}

async function fileToPdfBlob(f) {
  const k = FORMATS[f.fmt].kind;
  if (f.fmt === 'pdf') return f.blob;
  if (f.fmt === 'pptx') return pptxToPdf(f);
  if (k === 'image') return canvasesToPdf([await fileToCanvas(f)]);
  const docIR = await toDoc(f);
  return docToPdf(docIR.html);
}

$('#mergeBtn').addEventListener('click', async () => {
  const status = $('#mergeStatus');
  const btn = $('#mergeBtn');
  btn.disabled = true;
  try {
    const merged = await PDFLib.PDFDocument.create();
    for (let i = 0; i < state.mergeFiles.length; i++) {
      const f = state.mergeFiles[i];
      status.textContent = `Processing ${i + 1}/${state.mergeFiles.length}: ${f.name}`;
      const pdfBlob = await fileToPdfBlob(f);
      const src = await PDFLib.PDFDocument.load(await pdfBlob.arrayBuffer());
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach(p => merged.addPage(p));
    }
    const blob = new Blob([await merged.save()], { type: 'application/pdf' });
    const out = { name: 'merged.pdf', blob, fmt: 'pdf' };
    addResults('#mergeResultsCard', '#mergeResultList', [out], null);
    status.textContent = `Merged ${state.mergeFiles.length} files → ${merged.getPageCount()} pages (${fmtSize(blob.size)})`;
    toast('Merge complete ✔');
  } catch (e) {
    console.error(e);
    status.textContent = '';
    toast('Merge failed: ' + e.message, true);
  }
  btn.disabled = false;
});

/* ---- PDF tools tab ---- */
wireDrop('#dropPdf', '#pdfInput', async raw => {
  const f = ingest(raw).find(x => x.fmt === 'pdf');
  if (!f) { toast('Please drop a PDF file', true); return; }
  await loadPdfTool(f);
});

async function loadPdfTool(f) {
  const status = $('#pdfStatus');
  $('#pdfToolsCard').classList.remove('hidden');
  status.textContent = 'Rendering pages…';
  const bytes = await f.blob.arrayBuffer();
  const pdf = await getPdf({ blob: new Blob([bytes]) });
  state.pdfTool = { name: f.name, bytes, blob: f.blob, order: [], pages: [] };
  const grid = $('#pdfPages');
  grid.innerHTML = '';
  $('#pdfToolsTitle').textContent = `${f.name} — ${pdf.numPages} pages`;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 0.4 });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp, intent: 'print' }).promise;
    state.pdfTool.pages.push({ index: p - 1, rot: 0, del: false, selected: false, canvas: c });
  }
  renderPdfGrid();
  status.textContent = 'Click pages to select · use per-page buttons to rotate, delete or reorder';
}

function renderPdfGrid() {
  const grid = $('#pdfPages');
  grid.innerHTML = '';
  state.pdfTool.pages.forEach((pg, pos) => {
    const cell = document.createElement('div');
    cell.className = 'pdf-thumb' + (pg.selected ? ' selected' : '') + (pg.del ? ' deleted' : '');
    pg.canvas.style.transform = `rotate(${pg.rot}deg)`;
    cell.appendChild(pg.canvas);
    const label = document.createElement('div');
    label.className = 'pg-label';
    label.textContent = `Page ${pg.index + 1}${pg.rot ? ` · ${pg.rot}°` : ''}${pg.overlay ? ' · ✍' : ''}`;
    cell.appendChild(label);
    const btns = document.createElement('div');
    btns.className = 'pg-btns';
    const mk = (txt, fn, title) => {
      const b = document.createElement('button');
      b.className = 'icon'; b.textContent = txt; b.title = title;
      b.onclick = e => { e.stopPropagation(); fn(); renderPdfGrid(); };
      btns.appendChild(b);
    };
    mk('◀', () => { if (pos > 0) [state.pdfTool.pages[pos - 1], state.pdfTool.pages[pos]] = [pg, state.pdfTool.pages[pos - 1]]; }, 'Move earlier');
    mk('✏️', () => openPdfAnnotator(pg), 'Annotate — draw, text, highlight, whiteout');
    mk('↻', () => pg.rot = (pg.rot + 90) % 360, 'Rotate 90°');
    mk(pg.del ? '♻' : '🗑', () => pg.del = !pg.del, pg.del ? 'Restore' : 'Delete');
    mk('▶', () => { if (pos < state.pdfTool.pages.length - 1) [state.pdfTool.pages[pos + 1], state.pdfTool.pages[pos]] = [pg, state.pdfTool.pages[pos + 1]]; }, 'Move later');
    cell.appendChild(btns);
    cell.addEventListener('click', () => { pg.selected = !pg.selected; renderPdfGrid(); });
    grid.appendChild(cell);
  });
}

async function buildPdfFrom(pageSpecs) {
  const srcDoc = await PDFLib.PDFDocument.load(state.pdfTool.bytes.slice(0));
  const out = await PDFLib.PDFDocument.create();
  const copied = await out.copyPages(srcDoc, pageSpecs.map(p => p.index));
  for (let i = 0; i < copied.length; i++) {
    const page = copied[i], spec = pageSpecs[i];
    if (spec.overlay) {
      // burn the annotation layer on top; the original page content stays intact below
      const img = await out.embedPng(spec.overlay);
      const { width, height } = page.getSize();
      page.drawImage(img, { x: 0, y: 0, width, height });
    }
    if (spec.rot)
      page.setRotation(PDFLib.degrees((page.getRotation().angle + spec.rot) % 360));
    out.addPage(page);
  }
  return new Blob([await out.save()], { type: 'application/pdf' });
}

$('#pdfSelectAll').addEventListener('click', () => {
  const all = state.pdfTool.pages.every(p => p.selected);
  state.pdfTool.pages.forEach(p => p.selected = !all);
  renderPdfGrid();
});
$('#pdfRotateSel').addEventListener('click', () => {
  state.pdfTool.pages.filter(p => p.selected).forEach(p => p.rot = (p.rot + 90) % 360);
  renderPdfGrid();
});
$('#pdfDeleteSel').addEventListener('click', () => {
  state.pdfTool.pages.filter(p => p.selected).forEach(p => p.del = true);
  renderPdfGrid();
});
$('#pdfExtractSel').addEventListener('click', async () => {
  const sel = state.pdfTool.pages.filter(p => p.selected && !p.del);
  if (!sel.length) { toast('Select at least one page first', true); return; }
  const blob = await buildPdfFrom(sel);
  addResults('#pdfResultsCard', '#pdfResultList',
    [{ name: outName(state.pdfTool.name, 'pdf', '-extract'), blob, fmt: 'pdf' }],
    { name: state.pdfTool.name, blob: state.pdfTool.blob, fmt: 'pdf' });
  toast(`Extracted ${sel.length} pages ✔`);
});
$('#pdfSplitAll').addEventListener('click', async () => {
  const live = state.pdfTool.pages.filter(p => !p.del);
  const outs = [];
  for (const pg of live)
    outs.push({
      name: outName(state.pdfTool.name, 'pdf', `-page${pg.index + 1}`),
      blob: await buildPdfFrom([pg]),
      fmt: 'pdf',
    });
  addResults('#pdfResultsCard', '#pdfResultList', outs,
    { name: state.pdfTool.name, blob: state.pdfTool.blob, fmt: 'pdf' });
  toast(`Split into ${outs.length} single-page PDFs ✔`);
});
$('#pdfApply').addEventListener('click', async () => {
  const live = state.pdfTool.pages.filter(p => !p.del);
  if (!live.length) { toast('All pages are deleted — nothing to save', true); return; }
  const blob = await buildPdfFrom(live);
  addResults('#pdfResultsCard', '#pdfResultList',
    [{ name: outName(state.pdfTool.name, 'pdf', '-edited'), blob, fmt: 'pdf' }],
    { name: state.pdfTool.name, blob: state.pdfTool.blob, fmt: 'pdf' });
  toast('Edited PDF ready ✔');
});

$('#pdfCompressQ').addEventListener('input', e => $('#pdfCompressQVal').textContent = e.target.value + '%');
$('#pdfCompressBtn').addEventListener('click', async () => {
  if (!state.pdfTool) { toast('Load a PDF above first', true); return; }
  const btn = $('#pdfCompressBtn');
  btn.disabled = true;
  const status = $('#pdfStatus');
  try {
    const mode = $('#pdfCompressMode').value;
    const srcBlob = state.pdfTool.blob;
    const blob = await compressPdf({ blob: srcBlob }, mode, $('#pdfCompressQ').value / 100,
      (p, n) => status.textContent = `Compressing page ${p} / ${n}…`);
    const saved = Math.round((1 - blob.size / srcBlob.size) * 100);
    const outFile = { name: outName(state.pdfTool.name, 'pdf', '-compressed'), blob, fmt: 'pdf' };
    addResults('#pdfResultsCard', '#pdfResultList', [outFile],
      { name: state.pdfTool.name, blob: srcBlob, fmt: 'pdf' });
    status.textContent = `Compressed: ${fmtSize(srcBlob.size)} → ${fmtSize(blob.size)}` +
      (saved > 0 ? ` (−${saved}%)` : ' (already optimal — try a stronger mode)');
    toast('Compression done ✔ use Compare on the result to spot-check quality');
  } catch (e) {
    status.textContent = '';
    toast('Compression failed: ' + e.message, true);
  }
  btn.disabled = false;
});

/* ---- editor tab ---- */
wireDrop('#dropEdit', '#editInput', async raw => {
  const f = ingest(raw)[0];
  if (!f) return;
  const k = FORMATS[f.fmt].kind;
  if (k === 'image' || k === 'audio' || k === 'video') {
    toast('The editor works with documents and data files', true);
    return;
  }
  try {
    const docIR = await toDoc(f);
    state.editorSource = f;
    $('#editorArea').innerHTML = docIR.html || '<p></p>';
    $('#editorCard').classList.remove('hidden');
    toast(`${f.name} opened — edit away, then save as any format`);
  } catch (e) {
    toast('Could not open file: ' + e.message, true);
  }
});

/* ---- real-time collaboration: live-syncs the editor across every open
        OmniConvert window/tab on this machine (BroadcastChannel) ---- */
let collabOn = false, collabCh = null, collabTimer = null;
const collabId = Math.random().toString(36).slice(2);
$('#collabBtn').addEventListener('click', () => {
  collabOn = !collabOn;
  $('#collabBtn').textContent = `👥 Live sync: ${collabOn ? 'ON' : 'off'}`;
  if (collabOn && !collabCh) {
    collabCh = new BroadcastChannel('omniconvert-editor');
    collabCh.onmessage = e => {
      if (!collabOn || !e.data || e.data.from === collabId) return;
      const area = $('#editorArea');
      if (document.activeElement === area) return; // never stomp on live typing
      if (area.innerHTML !== e.data.html) {
        area.innerHTML = e.data.html;
        $('#editorCard').classList.remove('hidden');
      }
    };
  }
  if (collabOn) toast('Live sync ON — edits mirror instantly in every open OmniConvert window');
});
$('#editorArea').addEventListener('input', () => {
  if (!collabOn || !collabCh) return;
  clearTimeout(collabTimer);
  collabTimer = setTimeout(() =>
    collabCh.postMessage({ from: collabId, html: $('#editorArea').innerHTML }), 250);
});

$('#editorImgBtn').addEventListener('click', () => $('#editorImgInput').click());
$('#editorImgInput').addEventListener('change', () => {
  const f = $('#editorImgInput').files[0];
  if (!f) return;
  const fr = new FileReader();
  fr.onload = () => {
    $('#editorArea').focus();
    document.execCommand('insertImage', false, fr.result);
    toast('Image inserted — it will be embedded when you save as Word, PDF or HTML');
  };
  fr.readAsDataURL(f);
  $('#editorImgInput').value = '';
});

$$('.toolbar [data-cmd]').forEach(b =>
  b.addEventListener('click', () => { document.execCommand(b.dataset.cmd); $('#editorArea').focus(); }));
$$('.toolbar [data-block]').forEach(b =>
  b.addEventListener('click', () => { document.execCommand('formatBlock', false, b.dataset.block); $('#editorArea').focus(); }));

$('#editorSaveBtn').addEventListener('click', async () => {
  const target = $('#editorSaveFmt').value;
  const html = $('#editorArea').innerHTML;
  const srcName = state.editorSource ? state.editorSource.name : 'document.html';
  try {
    const virtual = { name: baseName(srcName) + '-edited.html', fmt: 'html', blob: makeBlob(fullHtml(html), 'html') };
    const outs = target === 'html'
      ? [virtual]
      : await convertOne(virtual, target);
    outs.forEach(o => { o.name = outName(srcName, o.fmt, '-edited'); });
    addResults('#editorResultsCard', '#editorResultList', outs, state.editorSource);
    outs.forEach(download);
    toast('Saved ✔');
  } catch (e) {
    toast('Save failed: ' + e.message, true);
  }
});

/* ---- annotation engine (shared by Image Studio & PDF page annotation) ----
   Two stacked canvases: the base stays untouched, all ink lands on a
   transparent overlay — so the underlying image/PDF content is never lost. */
function createAnnotator(container, base, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'annot-wrap';
  const ov = document.createElement('canvas');
  ov.width = base.width; ov.height = base.height;
  ov.className = 'annot-overlay';
  base.classList.add('annot-base');
  container.innerHTML = '';
  wrap.append(base, ov);
  container.append(wrap);
  const ctx = ov.getContext('2d');
  const undoStack = [];
  const snap = () => { undoStack.push(ctx.getImageData(0, 0, ov.width, ov.height)); if (undoStack.length > 30) undoStack.shift(); };
  const pos = e => {
    const r = ov.getBoundingClientRect();
    return { x: (e.clientX - r.left) * ov.width / r.width, y: (e.clientY - r.top) * ov.height / r.height };
  };
  const api = {
    base, overlay: ov, tool: 'pen', color: '#ff2d55', size: 4, ink: false,
    setTool(t) { this.tool = t; ov.style.cursor = t === 'text' ? 'text' : 'crosshair'; },
    undo() { const im = undoStack.pop(); if (im) ctx.putImageData(im, 0, 0); if (!undoStack.length) this.ink = false; },
    clear() { snap(); ctx.clearRect(0, 0, ov.width, ov.height); this.ink = false; },
    hasInk() { return this.ink; },
    merged() {
      const m = document.createElement('canvas');
      m.width = base.width; m.height = base.height;
      const g = m.getContext('2d');
      g.drawImage(base, 0, 0);
      g.drawImage(ov, 0, 0);
      return m;
    },
  };
  let down = false, start = null, before = null;
  ov.addEventListener('pointerdown', e => {
    e.preventDefault();
    ov.setPointerCapture(e.pointerId);
    const p = pos(e);
    if (api.tool === 'text') {
      const txt = prompt('Text to place:');
      if (txt) {
        snap();
        ctx.globalAlpha = 1;
        ctx.font = `bold ${api.size * 7}px Arial`;
        ctx.fillStyle = api.color;
        ctx.fillText(txt, p.x, p.y);
        api.ink = true;
      }
      return;
    }
    snap();
    down = true; start = p;
    if (api.tool === 'white' || api.tool === 'crop') before = ctx.getImageData(0, 0, ov.width, ov.height);
    else {
      ctx.globalAlpha = api.tool === 'highlight' ? 0.35 : 1;
      ctx.strokeStyle = api.color;
      ctx.lineWidth = api.tool === 'highlight' ? api.size * 4 : api.size;
      ctx.lineCap = ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }
  });
  ov.addEventListener('pointermove', e => {
    if (!down) return;
    const p = pos(e);
    if (api.tool === 'white' || api.tool === 'crop') {
      ctx.putImageData(before, 0, 0);
      ctx.globalAlpha = 1;
      if (api.tool === 'white') {
        ctx.fillStyle = '#fff';
        ctx.fillRect(start.x, start.y, p.x - start.x, p.y - start.y);
      } else {
        ctx.setLineDash([8, 6]);
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 2;
        ctx.strokeRect(start.x, start.y, p.x - start.x, p.y - start.y);
        ctx.setLineDash([]);
      }
    } else { ctx.lineTo(p.x, p.y); ctx.stroke(); }
  });
  ov.addEventListener('pointerup', e => {
    if (!down) return;
    down = false;
    const p = pos(e);
    if (api.tool === 'crop') {
      ctx.putImageData(before, 0, 0);   // remove the dashed preview
      undoStack.pop();                   // crop selection isn't ink
      const rect = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y),
                     w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
      if (rect.w > 8 && rect.h > 8 && opts.onCrop) opts.onCrop(rect);
      return;
    }
    ctx.globalAlpha = 1;
    api.ink = true;
  });
  return api;
}

/* ---- Image Studio ---- */
wireDrop('#dropStudio', '#studioInput', raw => {
  const f = ingest(raw).find(x => FORMATS[x.fmt].kind === 'image');
  if (!f) { toast('Drop an image file (PNG, JPG, WebP, BMP, GIF, SVG…)', true); return; }
  openStudio(f);
});

async function openStudio(f) {
  try {
    const base = await fileToCanvas(f);
    state.studio = { file: f, annot: createAnnotator($('#studioBox'), base, { onCrop: studioCrop }) };
    syncStudioAnnot();
    $('#studioW').value = base.width;
    $('#studioBright').value = 100;
    $('#studioContrast').value = 100;
    applyStudioFilter();
    $('#studioCard').classList.remove('hidden');
    toast(`${f.name} opened in the studio — draw, crop, adjust, then save in any format`);
  } catch (e) { toast('Could not open image: ' + e.message, true); }
}

function syncStudioAnnot() {
  const a = state.studio.annot;
  a.color = $('#studioColor').value;
  a.size = +$('#studioSize').value;
  a.setTool($$('.stool.active')[0]?.dataset.stool || 'pen');
}

function applyStudioFilter() {
  if (state.studio)
    state.studio.annot.base.style.filter =
      `brightness(${$('#studioBright').value}%) contrast(${$('#studioContrast').value}%)`;
}

function studioBaked() {
  const merged = state.studio.annot.merged();
  const b = document.createElement('canvas');
  b.width = merged.width; b.height = merged.height;
  const g = b.getContext('2d');
  g.filter = `brightness(${$('#studioBright').value}%) contrast(${$('#studioContrast').value}%)`;
  g.drawImage(merged, 0, 0);
  return b;
}

function studioTransform(fn) {
  const next = fn(state.studio.annot.merged());
  state.studio.annot = createAnnotator($('#studioBox'), next, { onCrop: studioCrop });
  syncStudioAnnot();
  applyStudioFilter();
  $('#studioW').value = next.width;
}

function studioCrop(rect) {
  studioTransform(src => {
    const c = document.createElement('canvas');
    c.width = Math.round(rect.w); c.height = Math.round(rect.h);
    c.getContext('2d').drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    return c;
  });
  toast('Cropped ✔');
}

$$('.stool').forEach(b => b.addEventListener('click', () => {
  $$('.stool').forEach(x => x.classList.toggle('active', x === b));
  if (state.studio) state.studio.annot.setTool(b.dataset.stool);
}));
$('#studioColor').addEventListener('input', () => state.studio && (state.studio.annot.color = $('#studioColor').value));
$('#studioSize').addEventListener('input', () => state.studio && (state.studio.annot.size = +$('#studioSize').value));
$('#studioUndo').addEventListener('click', () => state.studio && state.studio.annot.undo());
$('#studioClear').addEventListener('click', () => state.studio && state.studio.annot.clear());
$('#studioRotate').addEventListener('click', () => state.studio && studioTransform(src => {
  const c = document.createElement('canvas');
  c.width = src.height; c.height = src.width;
  const g = c.getContext('2d');
  g.translate(c.width, 0); g.rotate(Math.PI / 2); g.drawImage(src, 0, 0);
  return c;
}));
$('#studioFlip').addEventListener('click', () => state.studio && studioTransform(src => {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  g.translate(c.width, 0); g.scale(-1, 1); g.drawImage(src, 0, 0);
  return c;
}));
$('#studioResize').addEventListener('click', () => {
  const w = +$('#studioW').value;
  if (!state.studio || !(w >= 8)) return;
  studioTransform(src => {
    const c = document.createElement('canvas');
    c.width = w; c.height = Math.round(src.height * w / src.width);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c;
  });
});
$('#studioBright').addEventListener('input', applyStudioFilter);
$('#studioContrast').addEventListener('input', applyStudioFilter);

$('#studioSave').addEventListener('click', async () => {
  if (!state.studio) return;
  try {
    const fmt = $('#studioFmt').value;
    const baked = studioBaked();
    const blob = fmt === 'pdf' ? await canvasesToPdf([baked]) : await imageOut(baked, fmt, state.quality);
    const outFile = { name: outName(state.studio.file.name, fmt, '-edited'), blob, fmt };
    addResults('#studioResultsCard', '#studioResultList', [outFile], state.studio.file);
    download(outFile);
    toast('Saved ✔');
  } catch (e) { toast('Save failed: ' + e.message, true); }
});

$('#studioTable').addEventListener('click', async () => {
  if (!state.studio) return;
  toast('Extracting table with OCR…');
  try {
    const aoa = await imageToTable(studioBaked());
    if (!aoa || !aoa.length) throw new Error('No table or text detected in this image');
    const blob = await fromTable(aoa, 'csv', baseName(state.studio.file.name));
    const outFile = { name: outName(state.studio.file.name, 'csv'), blob, fmt: 'csv' };
    addResults('#studioResultsCard', '#studioResultList', [outFile], state.studio.file);
    download(outFile);
    toast(`Extracted ${aoa.length} rows × ${aoa[0].length} columns ✔`);
  } catch (e) { toast(e.message, true); }
});

/* ---- PDF page annotation ---- */
async function openPdfAnnotator(pg) {
  const pdf = await getPdf({ blob: new Blob([state.pdfTool.bytes]) });
  const page = await pdf.getPage(pg.index + 1);
  const vp = page.getViewport({ scale: 1.6 });
  const base = document.createElement('canvas');
  base.width = vp.width; base.height = vp.height;
  await page.render({ canvasContext: base.getContext('2d'), viewport: vp, intent: 'print' }).promise;
  const annot = createAnnotator($('#pdfAnnotBox'), base);
  if (pg.overlay) {
    const img = new Image();
    await new Promise(ok => { img.onload = ok; img.src = pg.overlay; });
    annot.overlay.getContext('2d').drawImage(img, 0, 0, base.width, base.height);
    annot.ink = true;
  }
  annot.color = $('#pdfAnnotColor').value;
  annot.size = +$('#pdfAnnotSize').value;
  annot.setTool($$('.ptool.active')[0]?.dataset.ptool || 'pen');
  state.pdfAnnot = { pg, annot };
  $('#pdfAnnotTitle').textContent = `✏️ Annotate page ${pg.index + 1} — original content underneath stays intact`;
  $('#pdfAnnotCard').classList.remove('hidden');
  $('#pdfAnnotCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$$('.ptool').forEach(b => b.addEventListener('click', () => {
  $$('.ptool').forEach(x => x.classList.toggle('active', x === b));
  if (state.pdfAnnot) state.pdfAnnot.annot.setTool(b.dataset.ptool);
}));
$('#pdfAnnotColor').addEventListener('input', () => state.pdfAnnot && (state.pdfAnnot.annot.color = $('#pdfAnnotColor').value));
$('#pdfAnnotSize').addEventListener('input', () => state.pdfAnnot && (state.pdfAnnot.annot.size = +$('#pdfAnnotSize').value));
$('#pdfAnnotUndo').addEventListener('click', () => state.pdfAnnot && state.pdfAnnot.annot.undo());
$('#pdfAnnotClear').addEventListener('click', () => state.pdfAnnot && state.pdfAnnot.annot.clear());
$('#pdfAnnotCancel').addEventListener('click', () => {
  state.pdfAnnot = null;
  $('#pdfAnnotCard').classList.add('hidden');
});
$('#pdfAnnotDone').addEventListener('click', () => {
  const a = state.pdfAnnot;
  if (!a) return;
  a.pg.overlay = a.annot.hasInk() ? a.annot.overlay.toDataURL('image/png') : null;
  state.pdfAnnot = null;
  $('#pdfAnnotCard').classList.add('hidden');
  renderPdfGrid();
  toast(a.pg.overlay
    ? `Page ${a.pg.index + 1} annotated ✍ — use “Apply edits & save” to bake it into the PDF`
    : 'No annotations on this page');
});

/* ================= AI layer: Agentic · Generative · RAG (Claude API) =================
   Everything runs client-side against the user's own Anthropic API key. */

const AI = {
  get key() { return localStorage.getItem('omni_ai_key') || ''; },
  get model() { return localStorage.getItem('omni_ai_model') || 'claude-sonnet-5'; },
};

async function claude(messages, { system, tools, maxTokens = 2048 } = {}) {
  if (!AI.key) throw new Error('Add your Anthropic API key in AI setup first');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': AI.key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: AI.model, max_tokens: maxTokens, system, tools, messages }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err.error && err.error.message) || `Claude API error ${res.status}`);
  }
  return res.json();
}

const claudeText = r => r.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();

async function aiText(f) {
  const kind = FORMATS[f.fmt].kind;
  if (kind === 'table') return aoaToText(await toTable(f));
  if (['doc', 'pdf', 'code', 'ref'].includes(kind)) return (await toDoc(f)).text;
  if (kind === 'image') return ocrCanvas(whiteBacked(await fileToCanvas(f)));
  throw new Error(`Cannot extract text from ${FORMATS[f.fmt].label}`);
}

/* ---- RAG: chunk + BM25-style retrieval over all loaded files ---- */
function chunkText(text, name) {
  const chunks = [];
  let buf = '';
  for (const p of text.split(/\n{2,}/)) {
    if ((buf + p).length > 900 && buf) { chunks.push(buf.trim()); buf = ''; }
    buf += p + '\n\n';
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks.map((t, i) => ({ id: `${name}#${i + 1}`, name, text: t }));
}

const aiTokenize = s => (s.toLowerCase().match(/[a-z0-9]{2,}/g) || []);

async function buildRagIndex() {
  const chunks = [];
  for (const f of state.files) {
    try {
      const kind = FORMATS[f.fmt].kind;
      if (!['doc', 'pdf', 'code', 'ref', 'table'].includes(kind)) continue;
      chunks.push(...chunkText(await aiText(f), f.name));
    } catch { /* unreadable file — skip */ }
  }
  if (!chunks.length) throw new Error('Load some readable documents in the Convert tab first');
  const df = {};
  for (const c of chunks) {
    c.tf = {};
    for (const w of aiTokenize(c.text)) c.tf[w] = (c.tf[w] || 0) + 1;
    for (const w of Object.keys(c.tf)) df[w] = (df[w] || 0) + 1;
  }
  const N = chunks.length;
  return {
    chunks,
    retrieve(q, k = 6) {
      return chunks.map(c => {
        let s = 0;
        const len = Object.values(c.tf).reduce((a, b) => a + b, 1);
        for (const t of aiTokenize(q)) {
          const tf = c.tf[t] || 0;
          if (!tf) continue;
          const idf = Math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5));
          s += idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * len / 120));
        }
        return { c, s };
      }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k);
    },
  };
}

async function ragAsk(question) {
  const idx = await buildRagIndex();
  const top = idx.retrieve(question);
  if (!top.length) throw new Error('Nothing relevant found in your loaded documents');
  const context = top.map(({ c }) => `[${c.id}]\n${c.text}`).join('\n\n---\n\n');
  const r = await claude(
    [{ role: 'user', content: `Context from the user's documents:\n\n${context}\n\nQuestion: ${question}` }],
    { system: 'Answer strictly from the provided context. Cite the chunk ids you used, like [report.pdf#3]. If the context is insufficient, say so plainly.' });
  return { answer: claudeText(r), sources: top.map(x => x.c.id) };
}

/* ---- Agent: Claude drives the converter through local tools ---- */
const AGENT_TOOLS = [
  { name: 'list_files', description: 'List files currently loaded in the converter plus files the agent already produced (name, format, size).', input_schema: { type: 'object', properties: {} } },
  { name: 'convert', description: 'Convert a file to a target format id (pdf, docx, txt, md, html, csv, xlsx, tex, pptx, epub, png, jpeg, mp3, enc, auto…). Returns produced file names.', input_schema: { type: 'object', properties: { name: { type: 'string', description: 'exact file name' }, target: { type: 'string' }, password: { type: 'string', description: 'only when target is enc, or when decrypting with target auto' } }, required: ['name', 'target'] } },
  { name: 'merge_to_pdf', description: 'Merge several files (PDFs, images, documents, spreadsheets) into one PDF, in the given order.', input_schema: { type: 'object', properties: { names: { type: 'array', items: { type: 'string' } } }, required: ['names'] } },
  { name: 'compress_pdf', description: 'Compress a PDF. mode: strong (smallest), balanced, hq, or lossless.', input_schema: { type: 'object', properties: { name: { type: 'string' }, mode: { type: 'string' } }, required: ['name'] } },
  { name: 'extract_text', description: 'Extract plain text from a file (OCR runs automatically on images/scans) so you can read or analyse it.', input_schema: { type: 'object', properties: { name: { type: 'string' }, max_chars: { type: 'number' } }, required: ['name'] } },
  { name: 'rag_agent', description: 'Delegate to the RAG agent: retrieves the most relevant passages from the user\'s loaded documents and answers a question grounded in them, with source citations.', input_schema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] } },
  { name: 'generative_agent', description: 'Delegate to the Generative AI agent: it writes or transforms content per your instruction and saves the result as a new Markdown file (which you can then convert to any format). Returns the new file name.', input_schema: { type: 'object', properties: { instruction: { type: 'string' }, file_name: { type: 'string', description: 'name for the produced .md file (without extension)' } }, required: ['instruction'] } },
  { name: 'llm_agent', description: 'Delegate to the plain LLM reasoning agent for analysis, classification or explanation that needs no files, retrieval or tools. Returns its answer as text.', input_schema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] } },
];

const agentFindFile = name =>
  state.files.find(f => f.name === name) || (state.aiOutputs || []).find(f => f.name === name);

async function runAgentTool(name, input) {
  const reg = f => {
    (state.aiOutputs ??= []).push(f);
    addResults('#aiResultsCard', '#aiResultList', [f], null);
  };
  switch (name) {
    case 'list_files':
      return JSON.stringify([...state.files, ...(state.aiOutputs || [])]
        .map(f => ({ name: f.name, format: f.fmt, size: fmtSize(f.blob.size) })));
    case 'convert': {
      const f = agentFindFile(input.name);
      if (!f) return 'ERROR: file not found: ' + input.name;
      const outs = await convertOne(f, input.target, { password: input.password });
      outs.forEach(reg);
      return 'Produced: ' + outs.map(o => `${o.name} (${fmtSize(o.blob.size)})`).join(', ');
    }
    case 'merge_to_pdf': {
      const files = (input.names || []).map(agentFindFile).filter(Boolean);
      if (!files.length) return 'ERROR: none of those files were found';
      const merged = await PDFLib.PDFDocument.create();
      for (const f of files) {
        const b = await fileToPdfBlob(f);
        const src = await PDFLib.PDFDocument.load(await b.arrayBuffer());
        (await merged.copyPages(src, src.getPageIndices())).forEach(p => merged.addPage(p));
      }
      const out = { name: 'agent-merged.pdf', blob: new Blob([await merged.save()], { type: 'application/pdf' }), fmt: 'pdf' };
      reg(out);
      return `Produced: ${out.name} (${merged.getPageCount()} pages, ${fmtSize(out.blob.size)})`;
    }
    case 'compress_pdf': {
      const f = agentFindFile(input.name);
      if (!f || f.fmt !== 'pdf') return 'ERROR: PDF not found: ' + input.name;
      const blob = await compressPdf(f, input.mode || 'balanced', 0.7);
      const out = { name: outName(f.name, 'pdf', '-compressed'), blob, fmt: 'pdf' };
      reg(out);
      return `Produced: ${out.name} (${fmtSize(f.blob.size)} → ${fmtSize(blob.size)})`;
    }
    case 'extract_text': {
      const f = agentFindFile(input.name);
      if (!f) return 'ERROR: file not found: ' + input.name;
      return (await aiText(f)).slice(0, input.max_chars || 4000) || '(no text found)';
    }
    case 'rag_agent': {
      const { answer, sources } = await ragAsk(input.question);
      return `RAG agent answer: ${answer}\nSources: ${sources.join(', ')}`;
    }
    case 'generative_agent': {
      const r = await claude([{ role: 'user', content: input.instruction }],
        { system: 'You are the Generative AI agent. Produce the requested content as clean, well-structured Markdown. Output only the content itself.', maxTokens: 4000 });
      const fname = (input.file_name || 'generated-' + Date.now()).replace(/\.md$/i, '').replace(/[^\w.-]+/g, '-') + '.md';
      const out = { name: fname, blob: makeBlob(claudeText(r), 'md'), fmt: 'md' };
      reg(out);
      return `Generative agent produced: ${fname} (${fmtSize(out.blob.size)})`;
    }
    case 'llm_agent': {
      const r = await claude([{ role: 'user', content: input.prompt }],
        { system: 'You are the LLM reasoning agent. Answer concisely and precisely.', maxTokens: 1500 });
      return 'LLM agent: ' + claudeText(r);
    }
    default:
      return 'ERROR: unknown tool ' + name;
  }
}

async function runAgent(instruction, log) {
  const messages = [{ role: 'user', content: instruction }];
  for (let turn = 0; turn < 8; turn++) {
    const r = await claude(messages, {
      system: 'You are the Agentic AI orchestrator of OmniConvert, leading a team of four agents. You operate the local file-conversion app through tools, and you can delegate: rag_agent answers questions from the user\'s documents (retrieval-augmented), generative_agent writes/transforms content into new files, llm_agent does pure reasoning. Start with list_files to see exact names. Use the most suitable agent/tool for each step, then summarise what was produced and where (the AI results list). Be concise.',
      tools: AGENT_TOOLS,
      maxTokens: 1500,
    });
    messages.push({ role: 'assistant', content: r.content });
    for (const b of r.content) if (b.type === 'text' && b.text.trim()) log('🤖 ' + b.text.trim());
    const toolUses = r.content.filter(b => b.type === 'tool_use');
    if (!toolUses.length || r.stop_reason !== 'tool_use') return;
    const results = [];
    for (const tu of toolUses) {
      log(`🔧 ${tu.name} ${JSON.stringify(tu.input || {})}`);
      let content;
      try { content = await runAgentTool(tu.name, tu.input || {}); }
      catch (e) { content = 'ERROR: ' + e.message; }
      log(`   ↳ ${String(content).slice(0, 200)}`);
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: String(content) });
    }
    messages.push({ role: 'user', content: results });
  }
  log('⚠️ Stopped after 8 agent turns — task may be incomplete.');
}

/* ---- AI boost: the four agents improve conversion quality automatically ----
   Generative agent → cleans OCR text output; LLM agent → repairs OCR tables
   and diagnoses failures; the orchestration lives in the convert flow itself. */
async function aiBoostOutputs(srcFile, outs, log = () => {}) {
  const boosted = [];
  const fromOcr = FORMATS[srcFile.fmt].kind === 'image' || srcFile.fmt === 'pdf';
  for (const o of outs) {
    try {
      if (fromOcr && ['txt', 'md'].includes(o.fmt)) {
        const text = await o.blob.text();
        if (text.length > 20 && text.length < 15000) {
          const r = await claude([{ role: 'user', content: 'Fix OCR/conversion errors in this text: correct misrecognised characters, broken words and spacing. Preserve ALL content and structure exactly; output only the corrected text in the same format.\n\n---\n\n' + text }],
            { system: 'You are the Generative AI agent doing automatic post-conversion cleanup.', maxTokens: 4000 });
          const fixed = claudeText(r);
          if (fixed && fixed.length > text.length * 0.5) {
            log(`✨ Generative agent cleaned ${o.name}`);
            boosted.push({ ...o, blob: makeBlob(fixed, o.fmt) });
            continue;
          }
        }
      }
      if (fromOcr && ['csv', 'tsv'].includes(o.fmt)) {
        const csv = await o.blob.text();
        if (csv.length > 10 && csv.length < 10000) {
          const r = await claude([{ role: 'user', content: `This table was extracted by OCR and may contain misread digits/characters or misaligned cells. Return the corrected table as ${o.fmt.toUpperCase()} only, no commentary.\n\n${csv}` }],
            { system: 'You are the LLM agent repairing OCR table extractions.', maxTokens: 3000 });
          const fixed = claudeText(r).replace(/^```\w*\n?|\n?```$/g, '').trim();
          if (fixed.includes(o.fmt === 'tsv' ? '\t' : ',')) {
            log(`🧠 LLM agent repaired table ${o.name}`);
            boosted.push({ ...o, blob: makeBlob(fixed, o.fmt) });
            continue;
          }
        }
      }
      boosted.push(o);
    } catch (e) {
      log('⚠️ AI boost skipped for ' + o.name + ': ' + e.message);
      boosted.push(o);
    }
  }
  return boosted;
}

async function aiErrorFix(file, step, errMsg) {
  const direct = targetsFor(file.fmt);
  const r = await claude([{ role: 'user', content: `A file conversion failed.\nFile: ${file.name} (format: ${file.fmt})\nRequested target: ${step}\nError: ${errMsg}\nDirect targets available from ${file.fmt}: ${direct.join(', ')}\nIf routing through one intermediate format could make ${file.fmt} → ${step} work, reply with JSON only: {"via":"<format id>"}. If unrecoverable, reply {"via":null}.` }],
    { system: 'You are the LLM agent diagnosing conversion failures. Reply with JSON only.', maxTokens: 150 });
  const m = /\{[^}]*\}/.exec(claudeText(r));
  if (!m) return null;
  try {
    const via = JSON.parse(m[0]).via;
    if (!via || !FORMATS[via] || via === step || via === file.fmt) return null;
    if (!direct.includes(via) || !targetsFor(via).includes(step)) return null;
    return via;
  } catch { return null; }
}

/* ---- AI tab wiring ---- */
$('#aiSaveKey').addEventListener('click', () => {
  localStorage.setItem('omni_ai_key', $('#aiKey').value.trim());
  localStorage.setItem('omni_ai_model', $('#aiModel').value);
  $('#aiSetupStatus').textContent = AI.key ? `✔ Key saved · model: ${AI.model}` : 'Key cleared';
});

$('#agentRun').addEventListener('click', async () => {
  const q = $('#agentInput').value.trim();
  if (!q) return;
  const logEl = $('#agentLog');
  logEl.classList.remove('hidden');
  logEl.textContent = '';
  const log = s => { logEl.textContent += s + '\n'; logEl.scrollTop = logEl.scrollHeight; };
  $('#agentRun').disabled = true;
  try { await runAgent(q, log); log('✅ Agent finished.'); }
  catch (e) { log('❌ ' + e.message); }
  $('#agentRun').disabled = false;
});

$('#ragRun').addEventListener('click', async () => {
  const q = $('#ragInput').value.trim();
  if (!q) return;
  const box = $('#ragAnswer');
  box.classList.add('show');
  box.textContent = 'Retrieving & thinking…';
  $('#ragRun').disabled = true;
  try {
    const { answer, sources } = await ragAsk(q);
    box.innerHTML = esc(answer) + `\n\n<span class="src">Sources: ${sources.map(esc).join(' · ')}</span>`;
  } catch (e) { box.textContent = '❌ ' + e.message; }
  $('#ragRun').disabled = false;
});

function refreshAiFileSel() {
  const sel = $('#aiFileSel');
  if (!sel) return;
  sel.innerHTML = state.files.length
    ? state.files.map(f => `<option value="${esc(f.name)}">${esc(f.name)}</option>`).join('')
    : '<option value="">(upload a file or load one in the Convert tab)</option>';
  const kb = $('#ragKbStatus');
  if (kb) {
    const readable = state.files.filter(f => ['doc', 'pdf', 'code', 'ref', 'table', 'image'].includes(FORMATS[f.fmt].kind));
    kb.textContent = readable.length
      ? `📂 Knowledge base: ${readable.length} file${readable.length > 1 ? 's' : ''} — ${readable.slice(0, 5).map(f => f.name).join(', ')}${readable.length > 5 ? '…' : ''}`
      : '📂 Knowledge base is empty — upload documents with 📎';
  }
}

/* ---- 📎 uploads shared by Agents 1–3: files join the common pool that every
        agent (and the Convert tab) can see ---- */
function aiAddFiles(rawFiles, selectNewest = false) {
  const added = ingest(rawFiles);
  if (!added.length) return;
  state.files.push(...added);
  renderFileList();
  if (selectNewest) $('#aiFileSel').value = added[added.length - 1].name;
  toast(`${added.length} file${added.length > 1 ? 's' : ''} uploaded — available to all four agents`);
}
let aiUpSelectNewest = false;
$('#aiUpInput').addEventListener('change', () => {
  aiAddFiles([...$('#aiUpInput').files], aiUpSelectNewest);
  $('#aiUpInput').value = '';
});
$('#agentUpBtn').addEventListener('click', () => { aiUpSelectNewest = false; $('#aiUpInput').click(); });
$('#ragUpBtn').addEventListener('click', () => { aiUpSelectNewest = false; $('#aiUpInput').click(); });
$('#genUpBtn').addEventListener('click', () => { aiUpSelectNewest = true; $('#aiUpInput').click(); });

async function aiAction(kind) {
  const f = state.files.find(x => x.name === $('#aiFileSel').value);
  if (!f) { toast('Load a file in the Convert tab first', true); return; }
  const status = $('#aiActStatus');
  status.textContent = 'Extracting text & asking the model…';
  try {
    const text = (await aiText(f)).slice(0, 24000);
    const prompts = {
      sum: 'Summarize this document concisely in Markdown: a 2-3 sentence overview, then key points as bullets.',
      fix: 'This text came from OCR/file conversion and may contain recognition errors, broken words and messy formatting. Return a corrected, cleanly structured Markdown version. Preserve ALL information; add nothing.',
      tr: `Translate this document into ${$('#aiLang').value.trim() || 'Hindi'}. Preserve the structure as Markdown.`,
    };
    const r = await claude([{ role: 'user', content: prompts[kind] + '\n\n---\n\n' + text }], { maxTokens: 4000 });
    const suffix = { sum: '-summary', fix: '-cleaned', tr: '-translated' }[kind];
    const out = { name: outName(f.name, 'md', suffix), blob: makeBlob(claudeText(r), 'md'), fmt: 'md' };
    addResults('#aiResultsCard', '#aiResultList', [out], f);
    status.textContent = '✔ Done — result added below (Markdown; convert it onward to any format)';
  } catch (e) {
    status.textContent = '';
    toast(e.message, true);
  }
}
$('#aiSummarize').addEventListener('click', () => aiAction('sum'));
$('#aiCleanup').addEventListener('click', () => aiAction('fix'));
$('#aiTranslate').addEventListener('click', () => aiAction('tr'));

/* Agent 3 — generate a brand-new document from a prompt */
$('#genDocRun').addEventListener('click', async () => {
  const q = $('#genDocInput').value.trim();
  if (!q) return;
  const status = $('#aiActStatus');
  status.textContent = 'Generative agent writing…';
  $('#genDocRun').disabled = true;
  try {
    const msg = await runAgentTool('generative_agent', { instruction: q, file_name: 'generated-document' });
    status.textContent = '✔ ' + msg + ' — convert it onward to Word, PDF, PPTX…';
  } catch (e) { status.textContent = ''; toast(e.message, true); }
  $('#genDocRun').disabled = false;
});

/* Agent 4 — direct LLM reasoning */
$('#llmRun').addEventListener('click', async () => {
  const q = $('#llmInput').value.trim();
  if (!q) return;
  const box = $('#llmAnswer');
  box.classList.add('show');
  box.textContent = 'Thinking…';
  $('#llmRun').disabled = true;
  try {
    const r = await claude([{ role: 'user', content: q }],
      { system: 'You are the LLM reasoning agent. Answer clearly and concisely.', maxTokens: 2000 });
    box.textContent = claudeText(r);
  } catch (e) { box.textContent = '❌ ' + e.message; }
  $('#llmRun').disabled = false;
});

/* ---- modal ---- */
$('#modalClose').addEventListener('click', () => $('#modal').classList.add('hidden'));
$('#modal').addEventListener('click', e => { if (e.target === $('#modal')) $('#modal').classList.add('hidden'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#modal').classList.add('hidden'); });

/* ---- boot ---- */
function boot() {
  const combos = countCombos();
  $('#comboBadge').textContent = `${combos.toLocaleString()} conversion paths · live`;
  $('#editorSaveFmt').innerHTML = formatOptionsHtml(['html', ...DOC_OUT.filter(f => f !== 'html')], 'docx');
  $('#studioFmt').innerHTML = formatOptionsHtml(['png', 'jpeg', 'webp', 'bmp', 'gif', 'svg', 'pdf'], 'png');
  const wfGrid = $('#wfGrid');
  WORKFLOWS.forEach(wf => {
    const b = document.createElement('button');
    b.className = 'wf-btn';
    b.innerHTML = `<b>${wf.ico} ${esc(wf.title)}</b><span>${esc(wf.desc)}</span>`;
    b.onclick = () => runWorkflow(wf);
    wfGrid.appendChild(b);
  });
  rebuildPipeline(['pdf']);
  $('#aiKey').value = AI.key;
  $('#aiModel').value = AI.model;
  state.aiBoost = !!localStorage.getItem('omni_ai_boost');
  $('#aiBoostChk').checked = state.aiBoost;
  if (AI.key) $('#aiSetupStatus').textContent = `✔ Key configured · model: ${AI.model}`;
  refreshAiFileSel();
  const missing = [];
  for (const [g, lib] of [['pdfjsLib', 'PDF engine'], ['PDFLib', 'PDF writer'], ['mammoth', 'Word reader'], ['XLSX', 'spreadsheet engine'], ['marked', 'Markdown'], ['TurndownService', 'HTML→MD'], ['JSZip', 'DOCX writer']])
    if (typeof window[g] === 'undefined') missing.push(lib);
  if (missing.length)
    toast(`Some engines failed to load: ${missing.join(', ')}`, true);
  // opened from the extension context menu: ?src=<url of image/link/page>
  const src = new URLSearchParams(location.search).get('src');
  if (src && /^https?:/i.test(src)) {
    $('#urlInput').value = src;
    importUrl();
  }
}
boot();

/* expose the engine for embedding / API use / testing */
window.Omni = { FORMATS, targetsFor, convertOne, toDoc, toTable, countCombos };
