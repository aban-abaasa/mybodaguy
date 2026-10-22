import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const sourceFiles = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(path);
  return /\.(ts|tsx|js|jsx)$/.test(name) ? [path] : [];
});

// mbg_ride_offers has PRIMARY KEY (ride_id, rider_id), so PostgREST also sees it as a
// many-to-many path between mbg_rides and mbg_riders. An embed that names no foreign key is
// then ambiguous and answers HTTP 300, which broke "My journeys" and the journey screen.
test('every rides -> riders embed names its foreign key', () => {
  const offenders = [];
  for (const file of [...sourceFiles(join(root, 'src')), ...sourceFiles(join(root, 'api'))]) {
    const text = readFileSync(file, 'utf8');
    // [^`'"] keeps the match inside one select string
    if (/mbg_rides(!inner)?\([^`'"]*?\bmbg_riders(!inner)?\(/.test(text)) offenders.push(file.replace(`${root}/`, ''));
  }
  assert.deepEqual(offenders, [], 'use rider:mbg_riders!mbg_rides_rider_id_fkey(...)');
});
