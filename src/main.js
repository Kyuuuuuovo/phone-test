// Entry point. Wires modules together at boot.

import * as db from './core/db.js';
import * as router from './core/router.js';
import * as ai from './core/ai.js';
import * as context from './core/context.js';

// Expose modules on window for console-driven dev/debugging until UI exists.
window.app = { db, router, ai, context };

async function boot() {
  await db.init();
  console.log('[boot] db ready');
  // TODO: register action handlers (text, reply, recall, image, voice)
  // TODO: register pages
  // TODO: router.navigate('home')
}

boot().catch(err => console.error('[boot] failed:', err));
