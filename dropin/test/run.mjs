/* Runs the Drop In test suites.
 *
 *   node dropin/test/run.mjs
 *
 * Needs Playwright with a Chromium — `npm i -g playwright && npx playwright
 * install chromium` if it isn't already there. Nothing else: the server is
 * in harness.mjs and the Supabase hop is stubbed, so no keys and no network. */
import negotiation from './negotiation.mjs';
import e2e from './e2e.mjs';

let total = 0, failed = 0;
for (const suite of [negotiation, e2e]) {
  const out = await suite();
  total += out.total; failed += out.failed;
}

console.log(failed ? `${failed} of ${total} checks failed` : `${total} checks passed`);
process.exit(failed ? 1 : 0);
