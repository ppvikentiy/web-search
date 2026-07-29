/**
 * Unit tests for archive journal storage.
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const store = {};

const chrome = {
  storage: {
    local: {
      async get(defaults) {
        const key = Object.keys(defaults)[0];
        return { [key]: store[key] ?? defaults[key] };
      },
      async set(data) {
        Object.assign(store, data);
      }
    }
  }
};

const contextObj = {
  chrome,
  globalThis: {},
  crypto: { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2, 8) },
  console
};

contextObj.globalThis = contextObj;
const context = vm.createContext(contextObj);

vm.runInContext(fs.readFileSync(path.join(root, 'lib/defaults.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'lib/archive-journal.js'), 'utf8'), context);

const WSArchiveJournal = contextObj.WSArchiveJournal;

let passed = 0;
let failed = 0;

async function step(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed += 1;
  }
}

console.log('\n=== Archive journal tests ===\n');

await step('add and list entries', async () => {
  store.archiveJournal = [];
  await WSArchiveJournal.add({ title: 'One', url: 'https://a.test', filename: 'one.zip', sizeBytes: 100 });
  await WSArchiveJournal.add({ title: 'Two', url: 'https://b.test', filename: 'two.zip', sizeBytes: 200 });
  const list = await WSArchiveJournal.list();
  if (list.length !== 2) throw new Error(`expected 2 entries, got ${list.length}`);
  if (list[0].title !== 'Two') throw new Error('newest entry should be first');
});

await step('remove entry by id', async () => {
  const list = await WSArchiveJournal.list();
  const id = list[0].id;
  await WSArchiveJournal.remove(id);
  const next = await WSArchiveJournal.list();
  if (next.some((item) => item.id === id)) throw new Error('entry still present');
});

await step('FIFO trims old entries', async () => {
  store.archiveJournal = [];
  for (let i = 0; i < 5; i += 1) {
    await WSArchiveJournal.add({ title: `Item ${i}`, url: `https://x.test/${i}`, filename: `${i}.zip`, sizeBytes: 10 }, 3);
  }
  const list = await WSArchiveJournal.list();
  if (list.length !== 3) throw new Error(`expected 3 entries max, got ${list.length}`);
  if (list[0].title !== 'Item 4') throw new Error('latest item missing');
});

await step('stats aggregates sizes', async () => {
  const stats = await WSArchiveJournal.stats();
  if (stats.count !== 3) throw new Error('unexpected count');
  if (stats.totalBytes !== 30) throw new Error(`unexpected total bytes: ${stats.totalBytes}`);
});

await step('clearAll empties journal', async () => {
  await WSArchiveJournal.clearAll();
  const list = await WSArchiveJournal.list();
  if (list.length !== 0) throw new Error('journal not empty after clearAll');
  const stats = await WSArchiveJournal.stats();
  if (stats.count !== 0) throw new Error('stats count should be 0');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
