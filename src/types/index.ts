import type { Timestamp } from 'firebase/firestore';

export type Denomination = 1000 | 5000 | 10000;

export interface Bill {
  id: string; // bill document id or normalized serial number
  serialNumber: string; // e.g. "AA123456B"
  denomination: Denomination;
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
  sightingsCount: number;
  totalDistanceKm: number;
  firstSightedAt: string;
  lastSightedAt: string;
  /** Server-only enforcement clock used by Firestore Rules; absent on legacy bills until lazily migrated. */
  lastSightedAtServer?: Timestamp | string;
}

export interface Sighting {
  id: string;
  billId: string;
  step: number; // 1, 2, 3...
  prefecture: string;
  municipality: string;
  latitudeApprox: number;
  longitudeApprox: number;
  userNote?: string;
  createdAt: string; // ISO string
  distanceFromPrevKm?: number;
  daysFromPrev?: number;
}

export interface BillWithSightings extends Bill {
  sightings: Sighting[];
}

export interface GlobalStats {
  totalBills: number;
  totalSightings: number;
  rediscoveredBills: number; // bills with sightingsCount >= 2
  maxDistanceKm: number;
  longestJourneyDays: number;
}

export interface RegisterBillInput {
  denomination: Denomination;
  serialNumber: string;
  prefecture: string;
  municipality: string;
  latitudeApprox: number;
  longitudeApprox: number;
  userNote?: string;
}

export interface RegisterResult {
  isRediscovery: boolean;
  bill: Bill;
  newSighting: Sighting;
  allSightings: Sighting[];
  sightingsCount: number;
  distanceFromPrevKm: number;
  daysFromPrev: number;
}
