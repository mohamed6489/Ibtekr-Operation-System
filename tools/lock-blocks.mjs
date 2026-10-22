// Writes tools/blocks.lock.json: for each block, the sha256 of the prototype's block (as split) and of
// app/js/blocks/<file> now. tests/split.test.mjs checks the files against it; rerun after editing a block.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { split } from './split-prototype.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const sha = (text) => createHash('sha256').update(text).digest('hex');
const parts = split(readFileSync(resolve(root, 'Prototype file', 'نظام إبتكر.html'), 'utf8'));
const lock = Object.fromEntries(parts.blocks.map((b) => [b.file, { prototype: sha(b.code), current: sha(readFileSync(resolve(root, 'app/js/blocks', b.file), 'utf8')) }]));
writeFileSync(resolve(root, 'tools/blocks.lock.json'), JSON.stringify(lock, null, 2) + '\n');
const edited = Object.keys(lock).filter((f) => lock[f].prototype !== lock[f].current);
console.log(`tools/blocks.lock.json: ${parts.blocks.length} blocks, edited since the split: ${edited.join(', ') || 'none'}`);
