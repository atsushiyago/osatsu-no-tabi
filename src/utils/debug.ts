/**
 * ?debug=timing がURLのsearch、hash、hrefのいずれかに含まれているかを判定
 * HashRouter環境やリバースプロキシ環境でも確実に検出する
 */
export function isDebugTiming(): boolean {
  // OCR previews and Firestore diagnostics may expose user-provided data.
  // Keep them available only on local development and the isolated QA build.
  if (!import.meta.env?.DEV && import.meta.env?.MODE !== 'qa') return false;
  if (typeof window === 'undefined') return false;
  const url = new URL(window.location.href);
  return url.searchParams.get('debug') === 'timing' || url.hash.includes('debug=timing');
}
