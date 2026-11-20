export const GEOFENCE_TYPES = ['office', 'warehouse', 'customer', 'project_site', 'branch'] as const
export type GeofenceType = (typeof GEOFENCE_TYPES)[number]

export interface GeofenceInput { name: string; type: string; latitude: string; longitude: string; radius_m: string; hysteresis_fixes: string }

/** Mirrors the database CHECK constraints so the user gets a clear message before the round trip. */
export function validateGeofence(i: GeofenceInput): { ok: true; value: { name: string; type: GeofenceType; latitude: number; longitude: number; radius_m: number; hysteresis_fixes: number } } | { ok: false; error: string } {
  const name = i.name.trim()
  if (!name || name.length > 120) return { ok: false, error: 'Name is required (up to 120 characters).' }
  if (!(GEOFENCE_TYPES as readonly string[]).includes(i.type)) return { ok: false, error: 'Choose a type.' }
  const num = (s: string) => (s.trim() === '' ? NaN : Number(s))
  const latitude = num(i.latitude), longitude = num(i.longitude), radius = num(i.radius_m), hyst = num(i.hysteresis_fixes)
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return { ok: false, error: 'Latitude must be between -90 and 90.' }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return { ok: false, error: 'Longitude must be between -180 and 180.' }
  if (!Number.isFinite(radius) || radius < 10 || radius > 50000) return { ok: false, error: 'Radius must be between 10 and 50,000 metres.' }
  if (!Number.isInteger(hyst) || hyst < 1 || hyst > 10) return { ok: false, error: 'Confirmation fixes must be a whole number from 1 to 10.' }
  return { ok: true, value: { name, type: i.type as GeofenceType, latitude, longitude, radius_m: radius, hysteresis_fixes: hyst } }
}
