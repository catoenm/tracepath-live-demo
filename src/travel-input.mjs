export const destinations = ['lisbon', 'kyoto', 'reykjavik'];
export const conditions = ['sunny', 'rain', 'unavailable'];
const invalid = () =>
  Object.assign(new Error('Invalid travel request; see README for supported fields'), {
    status: 400,
  });
function object(input) {
  if (!input || Array.isArray(input) || typeof input !== 'object') throw invalid();
}
export function validatePlaces(input) {
  object(input);
  if (!destinations.includes(input.destination)) throw invalid();
  return { destination: input.destination };
}
export function validateWeather(input) {
  const { destination } = validatePlaces(input);
  if (!conditions.includes(input.condition)) throw invalid();
  return { destination, condition: input.condition };
}
export function validateTrip(input) {
  const { destination } = validatePlaces(input);
  if (
    !Number.isInteger(input.days) ||
    input.days < 1 ||
    input.days > 5 ||
    !['balanced', 'culture', 'outdoors'].includes(input.preference) ||
    !conditions.includes(input.weather) ||
    typeof input.parallel !== 'boolean' ||
    (input.simulatePlannerFailure !== undefined &&
      typeof input.simulatePlannerFailure !== 'boolean')
  )
    throw invalid();
  return {
    destination,
    days: input.days,
    preference: input.preference,
    weather: input.weather,
    parallel: input.parallel,
    simulatePlannerFailure: input.simulatePlannerFailure ?? false,
  };
}
