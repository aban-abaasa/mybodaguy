/**
 * DECOY — not a real endpoint. Never linked from the app UI; only reachable
 * via the robots.txt Disallow entry and the hidden sr-only link in
 * LandingPage. Any request here is, by construction, a scanner or bot that
 * ignored robots.txt on purpose. Logs + flags the IP, then tarpits.
 *
 * Route: /api/admin/debug-keys
 */

import { decoyHandler } from '../_lib/canweShield.js';

export default decoyHandler;
