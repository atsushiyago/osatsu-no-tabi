/** Prefer the currently visible mobile viewport (including keyboard changes). */
export function getModalViewportHeight(visualViewportHeight: number | null | undefined, dynamicViewportHeight: number): number | undefined {
  if (typeof visualViewportHeight === 'number' && Number.isFinite(visualViewportHeight) && visualViewportHeight > 0) {
    return visualViewportHeight;
  }
  if (Number.isFinite(dynamicViewportHeight) && dynamicViewportHeight > 0) return dynamicViewportHeight;
  return undefined;
}
