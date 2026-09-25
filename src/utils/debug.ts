/**
 * ?debug=timing がURLのsearch、hash、hrefのいずれかに含まれているかを判定
 * HashRouter環境やリバースプロキシ環境でも確実に検出する
 */
export function isDebugTiming(): boolean {
  if (typeof window === 'undefined') return false;
  const url = new URL(window.location.href);
  return url.searchParams.get('debug') === 'timing' || url.hash.includes('debug=timing');
}
