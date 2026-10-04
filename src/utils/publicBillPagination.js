export function getPageWindow(documents, pageSize) {
  const items = documents.slice(0, pageSize);
  return {
    items,
    hasMore: documents.length > pageSize,
    cursor: items.at(-1) ?? null,
  };
}

export function projectPublicBill(id, data) {
  return {
    id,
    denomination: data.denomination,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    sightingsCount: data.sightingsCount,
    totalDistanceKm: data.totalDistanceKm,
    firstSightedAt: data.firstSightedAt,
    lastSightedAt: data.lastSightedAt,
    lastMunicipality: data.lastMunicipality,
  };
}
