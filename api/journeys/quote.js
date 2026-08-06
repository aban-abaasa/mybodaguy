// Vercel project root is the repository root; delegate to the frontend API
// implementation so this function is discovered and runs before the SPA rewrite.
export { default } from '../../frontend/api/journeys/quote.js';
