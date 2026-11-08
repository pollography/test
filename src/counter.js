// Synthetic acceptance fixture for the sandbox merge controller, not product code.
function adjustCounter(value, delta) {
  if (!Number.isInteger(value) || value < 0 || value > 99 || (delta !== -1 && delta !== 1)) {
    throw new RangeError('Expected count 0..99 and delta -1 or 1');
  }
  return Math.max(0, Math.min(99, value + delta));
}
module.exports = { adjustCounter };
