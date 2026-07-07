import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Runs as the first step of `npm run package`, before electron-builder.
// package.json's own buildNumber field is the single source of truth --
// incrementing it here (and recomputing build.buildVersion from it) means
// every packaged exe gets a distinct, traceable number with no separate
// counter file to keep in sync. build.buildVersion is a real
// electron-builder config key: it's embedded into the exe's actual
// Windows file-version resource (visible via right-click -> Properties ->
// Details, no need to even launch the app) and into the artifact
// filename via the ${buildVersion} template in package.json's
// win.artifactName. The in-app UI also reads buildNumber directly
// (see electron/main.js's get-app-info handler) so it's visible at a
// glance in both the exe's own metadata and the running app.
const here = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.join(here, '..', 'package.json');

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.buildNumber = (pkg.buildNumber ?? 0) + 1;
pkg.build.buildVersion = `${pkg.version}.${pkg.buildNumber}`;

writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

console.log(`Bumped build number to ${pkg.buildNumber} (buildVersion ${pkg.build.buildVersion}).`);
console.log('package.json was modified -- commit this change alongside the release.');
