/**
 * Builds the store-ready ZIP.
 *
 * The webstore rejects a package that carries anything the extension does not
 * actually load, and `dist/` is gitignored, so the archive is assembled from an
 * explicit allowlist rather than by zipping the working tree. That keeps the
 * upload reproducible and independent of what happens to be lying around in the
 * checkout (node_modules, src, tsconfig, vite config).
 *
 * Run: npm run package
 */
import { createWriteStream, readFileSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRaw } from 'node:zlib';
import { promisify } from 'node:util';

const deflate = promisify(deflateRaw);

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Declared in the manifest, therefore required in the archive. */
const REQUIRED = [
  'manifest.json',
  'dist/popup.html',
  'dist/popup.js',
  'dist/background.js',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png',
];

async function collect(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await collect(full, out);
    else out.push(relative(ROOT, full).split(sep).join('/'));
  }
  return out;
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const version = manifest.version;

for (const rel of REQUIRED) {
  try {
    await stat(join(ROOT, rel));
  } catch {
    console.error(`Refusing to package: manifest references '${rel}' but it does not exist. Run 'npm run build' first.`);
    process.exit(1);
  }
}

const files = (await collect(join(ROOT, 'dist')))
  .concat(await collect(join(ROOT, 'icons')))
  .concat(['manifest.json'])
  .sort();

const name = `cinesync-${version}.zip`;
const out = createWriteStream(join(ROOT, '..', name));

// Minimal store-method ZIP writer: one entry per file, deflated.
const central = [];
let offset = 0;

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff); return b; }

async function write(rel) {
  const raw = await readFile(join(ROOT, rel));
  const deflated = await deflate(raw);
  const useDeflate = deflated.length < raw.length;
  const data = useDeflate ? deflated : raw;
  const crc = crc32(raw);
  const nameBuf = Buffer.from(rel, 'utf8');

  const local = Buffer.concat([
    u32(0x04034b50), u16(20), u16(0), u16(useDeflate ? 8 : 0), u16(0), u16(0),
    u32(crc), u32(data.length), u32(raw.length), u16(nameBuf.length), u16(0), nameBuf,
  ]);
  out.write(local);
  out.write(data);

  central.push(Buffer.concat([
    u32(0x02014b50), u16(20), u16(20), u16(0), u16(useDeflate ? 8 : 0), u16(0), u16(0),
    u32(crc), u32(data.length), u32(raw.length), u16(nameBuf.length), u16(0), u16(0),
    u16(0), u16(0), u32(0), u32(offset), nameBuf,
  ]));
  offset += local.length + data.length;
  console.log(`  + ${rel} (${raw.length} B)`);
}

for (const rel of files) await write(rel);

const centralBuf = Buffer.concat(central);
out.write(centralBuf);
out.write(Buffer.concat([
  u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length),
  u32(centralBuf.length), u32(offset), u16(0),
]));
out.end();

console.log(`\nWrote ${name}: ${files.length} files, ${manifest.name} v${version}`);
