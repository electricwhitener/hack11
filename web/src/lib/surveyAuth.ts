/**
 * Surveyor gate.
 *
 * A passcode, not a Supabase role, on purpose: surveying happens on a phone
 * while walking round campus at night, and requiring a sign-in there would mean
 * typing an email and password on a dark path. The passcode is entered once and
 * kept on the device.
 *
 * This protects data quality, not secrets — the worst a leak allows is somebody
 * mislabelling paths, which the survey history makes visible and reversible. Do
 * not reuse this pattern for anything that actually needs authentication.
 */
export const SURVEY_PASSCODE = process.env.SURVEY_PASSCODE ?? '';

export const surveyEnabled = SURVEY_PASSCODE.length >= 4;

export function isSurveyor(req: Request): boolean {
  if (!surveyEnabled) return false;
  const given = req.headers.get('x-survey-key')?.trim();
  return Boolean(given) && given === SURVEY_PASSCODE;
}

export function refuse() {
  return Response.json({ error: 'Surveyor access required.' }, { status: 401 });
}
