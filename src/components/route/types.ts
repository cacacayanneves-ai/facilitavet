/** Formato serializavel de uma rota, compartilhado entre servidor e cliente. */
export interface SerializedStop {
  id: string;
  sequence: number;
  clinicId: string;
  clinicName: string;
  neighborhood: string | null;
  address: string | null;
  category: string;
  lat: number | null;
  lng: number | null;
  estimatedArrival: string | null;
  distanceFromPreviousMeters: number;
  durationFromPreviousSeconds: number;
  visitId: string | null;
  status: string;
}

export interface SerializedRoute {
  id: string;
  date: string;
  regionLabel: string | null;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  score?: number;
  estimated?: boolean;
  aiSummary?: string | null;
  origin: { lat: number; lng: number; label: string } | null;
  destination?: { lat: number; lng: number; label: string } | null;
  stops: SerializedStop[];
}
