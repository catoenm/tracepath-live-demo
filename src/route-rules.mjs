// A deterministic itinerary fixture, not a geographic route optimizer.
export function calculateRoute(input) {
  if (input.simulatePlannerFailure) throw new Error('Controlled route-planner failure');
  const suitable = input.places.filter(
    (place) => input.forecast.condition !== 'rain' || place.indoor,
  );
  const preferred =
    input.preference === 'culture'
      ? 'culture'
      : input.preference === 'outdoors'
        ? 'outdoors'
        : null;
  const ranked = [...suitable].sort(
    (a, b) =>
      Number(b.category === preferred) - Number(a.category === preferred) ||
      a.id.localeCompare(b.id),
  );
  if (!ranked.length) throw new Error('No suitable places');
  const days = Array.from({ length: input.days }, (_, index) => ({
    day: index + 1,
    stops: [ranked[(index * 2) % ranked.length], ranked[(index * 2 + 1) % ranked.length]],
  }));
  return { destination: input.destination, condition: input.forecast.condition, days };
}
