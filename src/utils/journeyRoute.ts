export interface PublicSightingRegion {
  municipality?: string | null;
}

export interface PublicSightingRoute {
  from: string;
  to: string;
}

/** Return the municipality route formed by the latest two public sightings. */
export function getLatestPublicSightingRoute(
  sightings: readonly PublicSightingRegion[] | null | undefined
): PublicSightingRoute | null {
  if (!sightings || sightings.length < 2) return null;

  const previousMunicipality = sightings[sightings.length - 2]?.municipality;
  const currentMunicipality = sightings[sightings.length - 1]?.municipality;
  if (!previousMunicipality || !currentMunicipality || previousMunicipality === currentMunicipality) {
    return null;
  }

  return { from: previousMunicipality, to: currentMunicipality };
}
