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
  /** Visitas (veterinarios) contabilizadas nesta parada. */
  veterinarians: number;
  /** Parte da visita (1-based) quando a clinica tem visita dividida. */
  part: number;
  /** Total de partes da visita desta clinica no mes. */
  totalParts: number;
}

export interface SerializedRoute {
  id: string;
  date: string;
  regionLabel: string | null;
  /** Visitas (veterinarios) do dia. */
  totalVisits?: number;
  /** Paradas (clinicas) do dia. */
  totalStops?: number;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  score?: number;
  estimated?: boolean;
  aiSummary?: string | null;
  origin: { lat: number; lng: number; label: string } | null;
  destination?: { lat: number; lng: number; label: string } | null;
  stops: SerializedStop[];
}
