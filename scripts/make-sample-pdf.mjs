// Generates a minimal text-based PDF that mimics the layout of a bureau
// consumer report, for local parser testing only. Not real data.
import { writeFileSync } from 'node:fs';

const pages = [
  [
    'SAMPLE EQUIFAX CANADA CONSUMER REPORT (TEST DATA)',
    'Report Date: August 1, 2026',
    'Equifax Credit Score 668',
    'Personal Information',
    'Name: Demo Client',
  ],
  [
    'Credit Accounts',
    'TD VISA',
    'Account Number: 4520XXXXXXXX4321',
    'Account Type: Revolving',
    'Status: Paid as agreed',
    'Balance: $2,140.55',
    'Credit Limit: $5,000',
    'Date Opened: 2019-04',
    'Date Reported: 2026-07',
    'SCOTIABANK LINE OF CREDIT',
    'Account Number: XXXXXXXX1188',
    'Account Type: Line of credit',
    'Status: 30 days late',
    'Balance: $3,900.00',
    'Past Due: $4,200.00',
    'Credit Limit: $10,000',
    'Date Opened: 2020-09',
    'Date Reported: 2026-07',
  ],
  [
    'Collections',
    'CBV COLLECTION SERVICES',
    'Account Number: XXXX7710',
    'Account Type: Collection',
    'Status: Collection',
    'Balance: $640.00',
    'Date Opened: 2025-02',
    'Date Reported: 2026-07',
  ],
];

function esc(s) { return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
const objects = [];
const add = (s) => { objects.push(s); return objects.length; };
const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
const pageIds = [];
const pagesId = objects.length + pages.length * 2 + 1;
for (const lines of pages) {
  let y = 760;
  let content = 'BT /F1 11 Tf\n';
  for (const l of lines) { content += `1 0 0 1 60 ${y} Tm (${esc(l)}) Tj\n`; y -= 18; }
  content += 'ET';
  const cId = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const pId = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${cId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`);
  pageIds.push(pId);
}
const realPagesId = add(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
if (realPagesId !== pagesId) throw new Error('id mismatch');
const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

let out = '%PDF-1.4\n';
const offsets = [];
objects.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
const xref = out.length;
out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
writeFileSync(new URL('./fixtures/sample-equifax.pdf', import.meta.url), out, 'latin1');
console.log('wrote scripts/fixtures/sample-equifax.pdf');
