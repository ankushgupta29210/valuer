// GitHub Pages has no SPA rewrite; serving index.html as 404.html makes
// deep links (e.g. /valuer/diagnose) load the app.
import { copyFileSync } from 'node:fs';
copyFileSync(new URL('../dist/index.html', import.meta.url), new URL('../dist/404.html', import.meta.url));
console.log('dist/404.html written');
