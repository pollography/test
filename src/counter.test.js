const { test } = require('node:test');
const assert = require('node:assert/strict');
const { adjustCounter } = require('./counter.js');

test('sandbox counter increments and decrements inside its range', () => {
  assert.equal(adjustCounter(41, 1), 42);
  assert.equal(adjustCounter(43, -1), 42);
});
test('sandbox counter clamps both boundaries', () => {
  assert.equal(adjustCounter(0, -1), 0);
  assert.equal(adjustCounter(99, 1), 99);
});
test('sandbox counter rejects invalid values and changes', () => {
  for (const value of [undefined, null, '1', -1, 100, 0.5, NaN, Infinity]) {
    assert.throws(() => adjustCounter(value, 1), RangeError);
  }
  for (const delta of [undefined, null, '1', 0, 2, -2, NaN, Infinity]) {
    assert.throws(() => adjustCounter(42, delta), RangeError);
  }
});
