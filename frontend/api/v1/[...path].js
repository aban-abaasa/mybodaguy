/**
 * Era API gateway entry: GET /api/v1/<anything>.
 * All behaviour lives in ../_lib/eraApi.js (unit tested); see that file's header for the routes.
 * (api/v1/internal/export-riders.js, where it exists, is a separate decoy route and takes precedence.)
 */
import { createEraHandler } from '../_lib/eraApi.js';

export default createEraHandler();
