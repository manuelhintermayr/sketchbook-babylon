// Copy the runtime-only files from the repo into dist/ so the folder
// can be uploaded directly to a static host (Apache, nginx, GitHub
// Pages, …). Run via `npm run build:static`, which builds the bundle
// first and then invokes this. dist/ is gitignored — always
// regenerate, never commit.
//
// Cross-platform via fs.cpSync (Node 16.7+). The repo's CLAUDE.md
// asks for a current LTS Node, which is well past that.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');

// Each entry is a source path relative to the repo root; it gets
// copied to the same relative path inside dist/. Folders are copied
// recursively. Order is just for readable log output.
const ITEMS = [
	'index.html',
	'favicon.ico',
	'audio',                                 // horn.wav + music/*.mp3
	'build/sketchbook.min.js',
	'build/sketchbook.min.js.LICENSE.txt',
	'build/assets',                          // *.glb level / vehicle models
	'src/img',                               // textures referenced from code
	'vendor/joycon',                         // Joycon lib + Client.js + glue
];

// Wipe and recreate dist
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

let missing = false;
for (const item of ITEMS)
{
	const src = path.join(ROOT, item);
	const dst = path.join(DIST, item);

	if (!fs.existsSync(src))
	{
		console.error(`  missing: ${item}`);
		missing = true;
		continue;
	}

	fs.mkdirSync(path.dirname(dst), { recursive: true });
	fs.cpSync(src, dst, { recursive: true });
	console.log(`  copied:  ${item}`);
}

if (missing)
{
	console.error('\nOne or more required files were missing. Did you run `npm run build` first?');
	process.exit(1);
}

console.log(`\ndist/ ready at ${DIST}`);
console.log('Upload the contents to your web host. All paths are relative — works at any subpath.');
