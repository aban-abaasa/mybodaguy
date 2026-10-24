// Lets plain Node load this app's TypeScript the way Vite does: an import without a file extension ('./supabaseClient')
// is tried again as '.ts' / '.tsx' / '.js' / '.jsx' / '/index.ts'. Used by tests that import services straight from src/.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !/^\.\.?\//.test(specifier)) throw error;
    for (const suffix of ['.ts', '.tsx', '.js', '.jsx', '/index.ts']) {
      try { return await nextResolve(specifier + suffix, context); } catch { /* try the next one */ }
    }
    throw error;
  }
}
