// Azura Bay: Night Run — the gta6-01 hand-in (Node 22, standard library only). The game is
// this directory's game/ folder: a 3D open-world night-city crime game, plain static files a
// desktop browser loads offline (game/index.html, its ES modules and the vendored three.js; no
// network request). This program copies game/ and screenshots/ from beside this file to /output,
// writes /output/dossier.json (the summary the judge reads) with the vendored make.fun library,
// then re-reads the output and checks it against the scorer's caps. The four screenshots are
// staged scenes of the real game (game/src/shots.js); the first by name is the cover.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all, or a path under game/ over 1000 bytes: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);

// --- Entry self-check and run summary ---------------------------------------
// Everything above is the hand-in itself: copy the game, copy the screens,
// write the dossier. This section is the receipt. It re-reads what actually
// landed in the output directory (never the sources, so a bad copy cannot
// hide), applies the limits the scorer advertises for this bounty, and
// prints a short summary of the run. A failed check aborts with exit code 1
// and one line per problem, so a broken entry can never exit looking fine.

import { readdirSync, readFileSync, statSync } from 'node:fs';

const SHOT_CAP_BYTES = 262144; // 256 KiB, the same per-screenshot cap as above
const INDEX_CAP_BYTES = 1048576; // 1 MiB, the cap on game/index.html

// Every regular file under dir, as full paths, in directory order.
function walkFiles(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...walkFiles(full));
    else found.push(full);
  }
  return found;
}

// 'JPEG' or 'PNG' when the file's leading bytes carry that format's magic,
// null otherwise. A JPEG must also end on its FF D9 marker: a file that
// starts like a photo but stops mid-stream is a truncated upload, not one.
function imageKindOf(path) {
  const bytes = readFileSync(path);
  const jpegMagic = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (jpegMagic) {
    const endsWhole = bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
    return endsWhole ? 'JPEG' : null;
  }
  const pngMagic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= pngMagic.length && pngMagic.every((byte, i) => bytes[i] === byte)) return 'PNG';
  return null;
}

// The game's own name, lifted from the <title> of the page that was copied.
function titleOf(dir) {
  const html = readFileSync(join(dir, 'game', 'index.html'), 'utf8');
  const match = html.match(/<title>([^<]+)<\/title>/);
  return match ? match[1].trim() : '(no title found)';
}

// Inspect the finished output directory. Returns the problems found (an
// empty list means the entry is sound) alongside the facts for the summary.
function inspectOutput(dir) {
  const problems = [];

  const shotDir = join(dir, 'screenshots');
  const shotNames = existsSync(shotDir) ? readdirSync(shotDir).sort() : [];
  if (shotNames.length < 3 || shotNames.length > 4) {
    problems.push(`screenshots: this bounty wants 3 or 4 images, the output holds ${shotNames.length}`);
  }
  const shots = shotNames.map((name) => {
    const size = statSync(join(shotDir, name)).size;
    const kind = imageKindOf(join(shotDir, name));
    if (kind === null) problems.push(`screenshots/${name}: not a whole JPEG or PNG by its magic bytes`);
    if (size > SHOT_CAP_BYTES) problems.push(`screenshots/${name}: ${size} bytes is over the 256 KiB cap`);
    return { name, kind, size };
  });

  const gameDir = join(dir, 'game');
  const gameFiles = existsSync(gameDir) ? walkFiles(gameDir) : [];
  const indexPath = join(gameDir, 'index.html');
  if (!existsSync(indexPath)) {
    problems.push('game/index.html: missing from the output');
  } else if (statSync(indexPath).size > INDEX_CAP_BYTES) {
    problems.push(`game/index.html: ${statSync(indexPath).size} bytes is over the 1 MiB cap`);
  }

  const dossierPath = join(dir, 'dossier.json');
  const dossierBytes = existsSync(dossierPath) ? statSync(dossierPath).size : 0;
  if (dossierBytes === 0) problems.push('dossier.json: missing or empty in the output');

  return { problems, shots, gameFileCount: gameFiles.length, dossierBytes };
}

const report = inspectOutput(out);
if (report.problems.length > 0) {
  console.error('Entry self-check FAILED — the hand-in is not sound:');
  for (const problem of report.problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`Entry self-check passed: ${titleOf(out)}`);
console.log(`  game files copied: ${report.gameFileCount}`);
console.log(`  dossier.json: ${report.dossierBytes} bytes`);
for (const shot of report.shots) {
  console.log(`  screenshot ${shot.name}: ${shot.kind}, ${shot.size} bytes`);
}
