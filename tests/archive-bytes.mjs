/**
 * Unit tests for archive byte normalization.
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const contextObj = { globalThis: {}, console, Uint8Array, ArrayBuffer, Array, Object, Number };
contextObj.globalThis = contextObj;
const context = vm.createContext(contextObj);

vm.runInContext(fs.readFileSync(path.join(root, 'lib/archive-bytes.js'), 'utf8'), context);

const { normalizeZipBytes, isZipBytes } = contextObj.WSArchiveBytes;

let passed = 0;
let failed = 0;

function step(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed += 1;
  }
}

console.log('\n=== Archive bytes tests ===\n');

step('normalize Uint8Array copy', () => {
  const source = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  const out = normalizeZipBytes(source);
  if (!(out instanceof Uint8Array)) throw new Error('expected Uint8Array');
  if (out[0] !== 0x50 || out[1] !== 0x4b) throw new Error('bytes mismatch');
});

step('normalize plain object with numeric keys', () => {
  const out = normalizeZipBytes({ 0: 0x50, 1: 0x4b, 2: 3, 3: 4 });
  if (!out || out.length !== 4) throw new Error(`expected 4 bytes, got ${out?.length}`);
  if (out[0] !== 0x50 || out[1] !== 0x4b) throw new Error('bytes mismatch');
});

step('isZipBytes detects PK signature', () => {
  if (!isZipBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))) {
    throw new Error('valid zip not detected');
  }
  if (isZipBytes(new Uint8Array([1, 2, 3, 4]))) {
    throw new Error('invalid zip detected as valid');
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
