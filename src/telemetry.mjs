import { context, propagation, trace, SpanStatusCode } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { resourceFromAttributes } from '@opentelemetry/resources';

// A tiny OTel span processor also publishes starts, so unfinished work can light up live.
// Completed records use the SDK's measured start/end times, never a simulated duration.
const pending = new Set();
const milliseconds = ([seconds, nanos]) => seconds * 1000 + nanos / 1e6;
function publish(span, ended) {
  const attributes = span.attributes;
  const record = {
    traceId: span.spanContext().traceId,
    spanId: span.spanContext().spanId,
    parentSpanId: span.parentSpanContext?.spanId,
    operation: attributes['tracepath.operation'],
    runId: attributes['tracepath.run'],
    requestId: attributes['tracepath.request'],
    revision: process.env.TRACEPATH_REVISION,
    service: process.env.OTEL_SERVICE_NAME,
    startMs: milliseconds(span.startTime),
    ...(ended
      ? {
          endMs: milliseconds(span.endTime),
          durationMs: milliseconds(span.duration),
          error: span.status.code === SpanStatusCode.ERROR,
          message: span.status.message,
        }
      : {}),
  };
  const task = fetch(`${process.env.TELEMETRY_URL}/spans`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-demo-token': process.env.TRACEPATH_DEMO_TOKEN,
    },
    body: JSON.stringify(record),
    signal: AbortSignal.timeout(3000),
  })
    .then((response) => {
      if (!response.ok) throw new Error(`Telemetry ${response.status}`);
    })
    .catch((error) => console.error('Telemetry delivery failed:', error.message));
  pending.add(task);
  void task.finally(() => pending.delete(task));
}
const processor = {
  onStart: (span) => publish(span, false),
  onEnd: (span) => publish(span, true),
  forceFlush: async () => {
    await Promise.all([...pending]);
  },
  shutdown: async () => {
    await Promise.all([...pending]);
  },
};
const provider = new NodeTracerProvider({
  resource: resourceFromAttributes({ 'service.name': process.env.OTEL_SERVICE_NAME }),
  spanProcessors: [processor],
});
provider.register();
const tracer = trace.getTracer('tracepath-demo', '1.0.0');

export async function operation(id, work) {
  const baggage = propagation.getBaggage(context.active());
  return tracer.startActiveSpan(
    id,
    {
      attributes: {
        'tracepath.operation': id,
        'tracepath.run': baggage?.getEntry('run')?.value ?? '',
        'tracepath.request': baggage?.getEntry('request')?.value ?? '',
      },
    },
    async (span) => {
      try {
        return await work();
      } catch (error) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
export function requestContext(headers, work) {
  const extracted = propagation.extract(context.active(), headers);
  const baggage = propagation.createBaggage({
    run: { value: headers['x-tracepath-run'] ?? '' },
    request: { value: headers['x-tracepath-request'] ?? '' },
  });
  return context.with(propagation.setBaggage(extracted, baggage), work);
}
export function outgoingHeaders() {
  const headers = {
    'content-type': 'application/json',
    'x-demo-token': process.env.TRACEPATH_DEMO_TOKEN,
  };
  propagation.inject(context.active(), headers);
  const baggage = propagation.getBaggage(context.active());
  headers['x-tracepath-run'] = baggage?.getEntry('run')?.value ?? '';
  headers['x-tracepath-request'] = baggage?.getEntry('request')?.value ?? '';
  return headers;
}
export const flush = () => provider.forceFlush();
