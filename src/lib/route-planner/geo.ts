import { OFFLINE_CALIBRATION } from './config';
import type { LatLng, TravelMatrix, TravelMatrixRequest } from './types';

const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Distancia geodesica em metros. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Projecao equirretangular local em metros.
 *
 * Clustering em graus de lat/lng distorce: 1 grau de longitude vale menos que
 * 1 grau de latitude fora do equador. Projetamos para um plano metrico local
 * antes de rodar k-means, senao os grupos "esticam" no eixo leste-oeste.
 */
export function createProjection(points: LatLng[]) {
  const refLat = points.length
    ? points.reduce((sum, p) => sum + p.lat, 0) / points.length
    : 0;
  const refLng = points.length
    ? points.reduce((sum, p) => sum + p.lng, 0) / points.length
    : 0;
  const mPerDegLat = 111_132.92;
  const mPerDegLng = 111_412.84 * Math.cos(toRad(refLat));

  return {
    refLat,
    refLng,
    project(p: LatLng): [number, number] {
      return [(p.lng - refLng) * mPerDegLng, (p.lat - refLat) * mPerDegLat];
    },
    unproject(x: number, y: number): LatLng {
      return { lat: refLat + y / mPerDegLat, lng: refLng + x / mPerDegLng };
    },
  };
}

export function centroid(points: LatLng[]): LatLng {
  if (!points.length) return { lat: 0, lng: 0 };
  const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lng = points.reduce((s, p) => s + p.lng, 0) / points.length;
  return { lat, lng };
}

/** Raio medio: distancia media dos pontos ao centroide (m). */
export function meanRadiusMeters(points: LatLng[]): number {
  if (points.length < 2) return 0;
  const c = centroid(points);
  return points.reduce((s, p) => s + haversineMeters(c, p), 0) / points.length;
}

/** Azimute em graus (0 = norte, sentido horario). */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/** Diferenca angular absoluta normalizada para [0, 180]. */
export function angleDelta(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

/**
 * Estimativa geometrica de deslocamento — o fallback offline.
 *
 * Usado (a) quando nao ha chave do Google, (b) durante o clustering, onde
 * pedir matriz real de 100x100 custaria 10.000 elementos por execucao sem
 * mudar materialmente a decisao de agrupamento.
 */
export function estimateTravel(a: LatLng, b: LatLng): { distanceMeters: number; durationSeconds: number } {
  const geodesic = haversineMeters(a, b);
  const distanceMeters = Math.round(geodesic * OFFLINE_CALIBRATION.detourFactor);
  const km = distanceMeters / 1000;
  const speed =
    km > OFFLINE_CALIBRATION.interurbanThresholdKm
      ? OFFLINE_CALIBRATION.interurbanSpeedKmh
      : OFFLINE_CALIBRATION.urbanSpeedKmh;
  const durationSeconds =
    km === 0 ? 0 : Math.round((km / speed) * 3600) + OFFLINE_CALIBRATION.fixedStopOverheadSeconds;
  return { distanceMeters, durationSeconds };
}

/** Matriz estimada — mesma interface do provider real. */
export function estimateMatrix(req: TravelMatrixRequest): TravelMatrix {
  const distances: number[][] = [];
  const durations: number[][] = [];
  for (const o of req.origins) {
    const dRow: number[] = [];
    const tRow: number[] = [];
    for (const d of req.destinations) {
      const { distanceMeters, durationSeconds } = estimateTravel(o, d);
      dRow.push(distanceMeters);
      tRow.push(durationSeconds);
    }
    distances.push(dRow);
    durations.push(tRow);
  }
  return { distances, durations, provider: 'offline-geometric', estimated: true };
}
