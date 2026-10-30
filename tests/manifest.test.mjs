import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateTrip, validateWeather, validatePlaces } from '../src/travel-input.mjs';
import { manifest } from '../scripts/support.mjs';

test('every public business endpoint has a traced root and compatible sample requests', () => {
  assert.equal(manifest.entrypoints.length, 5);
  assert.equal(
    new Set(manifest.operations.map((operation) => operation.id)).size,
    manifest.operations.length,
  );
  assert.equal(
    new Set(manifest.scenarios.map((scenario) => scenario.id)).size,
    manifest.scenarios.length,
  );
  for (const operation of manifest.operations) {
    const source = readFileSync(new URL(`../${operation.path}`, import.meta.url), 'utf8');
    assert.ok(source.includes(`function ${operation.symbol}(`));
    assert.ok(source.includes(`operation('${operation.id}'`));
  }
  for (const entry of manifest.entrypoints) {
    assert.ok(manifest.operations.some((operation) => operation.id === entry.operation));
    const source = readFileSync(new URL(`../${entry.path}`, import.meta.url), 'utf8');
    assert.ok(source.includes(`app.${entry.method.toLowerCase()}('${entry.route}'`));
    for (const id of entry.scenarioIds) {
      const scenario = manifest.scenarios.find((scenario) => scenario.id === id);
      assert.ok(scenario && scenario.requests.length >= 1 && scenario.requests.length <= 3);
      for (const payload of scenario.requests) {
        if (entry.payloadKind === 'empty') assert.deepEqual(payload, {});
        else {
          assert.equal(entry.payloadKind, 'json');
          const validate =
            entry.operation === 'trip.plan'
              ? validateTrip
              : entry.operation === 'places.load'
                ? validatePlaces
                : validateWeather;
          assert.doesNotThrow(() => validate(payload));
        }
      }
    }
  }
});
