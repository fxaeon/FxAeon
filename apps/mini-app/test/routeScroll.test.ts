import assert from 'node:assert/strict';
import test from 'node:test';
import { createRouteScrollMemory } from '../src/lib/routeScroll';

test('route scroll restores each route independently and defaults new routes to the top', () => {
  const memory = createRouteScrollMemory();
  memory.save('/earn', { top: 420, left: 12 });
  memory.save('/borrow', { top: 870, left: 0 });
  assert.deepEqual(memory.read('/earn'), { top: 420, left: 12 });
  assert.deepEqual(memory.read('/borrow'), { top: 870, left: 0 });
  assert.deepEqual(memory.read('/trade'), { top: 0, left: 0 });
});

test('scroll memory owns copies, validates coordinates, and bounds its session footprint', () => {
  const memory = createRouteScrollMemory(2);
  const input = { top: 100, left: 2 };
  memory.save('/earn', input);
  input.top = 999;
  const output = memory.read('/earn');
  output.top = 500;
  assert.equal(memory.read('/earn').top, 100);
  memory.save('/borrow', { top: -2, left: -1 });
  assert.deepEqual(memory.read('/borrow'), { top: 0, left: 0 });
  memory.save('/earn', { top: Infinity, left: 0 });
  assert.equal(memory.read('/earn').top, 100);
  memory.save('/trade', { top: 300, left: 0 });
  assert.deepEqual(memory.read('/earn'), { top: 0, left: 0 });
});
