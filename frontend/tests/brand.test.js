import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsPDF } from 'jspdf';
import { PRODUCT_OWNER, PRODUCT_OWNER_URL } from '../src/constants/brand.ts';
import { drawProductOf } from '../src/mybodaguy/utils/pdfCredit.ts';

// "A product of GODMINDERA ORGANISATION (U) LTD" links to the owner's site on IcanEra, icanera.space/<business-name>, wherever it shows.

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

test('the owner is named and linked in the IcanEra business-site format', () => {
  assert.equal(PRODUCT_OWNER, 'GODMINDERA ORGANISATION (U) LTD');
  assert.equal(PRODUCT_OWNER_URL, 'https://icanera.space/godmindera-organisation-u-ltd');
});

// A doc that records what is drawn, with a width of 2 units per character.
const fakeDoc = () => {
  const calls = [];
  return {
    calls,
    getTextWidth: (text) => text.length * 2,
    getFontSize: () => 9,
    getTextColor: () => '#6b7280',
    setDrawColor: (c) => calls.push(['draw', c]),
    text: (t, x, y) => calls.push(['text', t, x, y]),
    textWithLink: (t, x, y, o) => calls.push(['link', t, x, y, o.url]),
    line: (x1, y1, x2, y2) => calls.push(['line', x1, y1, x2, y2]),
  };
};

test('a PDF credit draws the lead-in, then the company name as a link with an underline', () => {
  const doc = fakeDoc();
  const width = drawProductOf(doc, 10, 100, { lead: 'Generated today | ' });
  const prefix = 'Generated today | A product of ';
  assert.deepEqual(doc.calls.find((c) => c[0] === 'text'), ['text', prefix, 10, 100]);
  assert.deepEqual(doc.calls.find((c) => c[0] === 'link'), ['link', PRODUCT_OWNER, 10 + prefix.length * 2, 100, PRODUCT_OWNER_URL]);
  const [, x1, y1, x2, y2] = doc.calls.find((c) => c[0] === 'line');
  assert.equal(y1, y2, 'the underline is horizontal');
  assert.ok(y1 > 100, 'and sits just under the baseline');
  assert.equal(x1, 10 + prefix.length * 2, 'it starts where the name starts');
  assert.equal(x2, 10 + width, 'and ends where the line ends');
  assert.equal(x2 - x1, PRODUCT_OWNER.length * 2, 'so it is as wide as the name');
});

test('a centred or right-aligned PDF credit is aligned as a whole line, name included', () => {
  const doc = fakeDoc();
  const width = drawProductOf(doc, 105, 280, { align: 'center' });
  assert.equal(doc.calls.find((c) => c[0] === 'text')[2], 105 - width / 2);
  const right = fakeDoc();
  drawProductOf(right, 200, 280, { align: 'right' });
  assert.equal(right.calls.find((c) => c[0] === 'link')[2] + PRODUCT_OWNER.length * 2, 200);
});

test('in a real PDF the company name is a clickable link annotation', () => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.setFontSize(9);
  drawProductOf(doc, 10, 286, { lead: 'Generated today  |  ' });
  const pdf = doc.output();
  assert.ok(pdf.includes(`/URI (${PRODUCT_OWNER_URL})`), 'no link annotation to the owner site in the PDF');
  assert.ok(pdf.includes('/Subtype /Link'));
});

test('no credit is left as plain text: each one links', () => {
  const offenders = [];
  const walk = (dir) => readdirSync(dir).forEach((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return walk(file);
    if (!/\.(jsx?|tsx?)$/.test(name)) return;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (/A product of GODMINDERA/.test(line) && !/^\s*(\*|\/\/|\/\*)/.test(line)) offenders.push(`${path.relative(src, file)}:${i + 1}`);
    });
  });
  walk(src);
  assert.deepEqual(offenders, [], 'plain-text credit: use <ProductOfLink /> or drawProductOf()');
});
