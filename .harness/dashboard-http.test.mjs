import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAllowedDashboardHost,
  renderDashboardPage,
} from './dashboard-http.mjs';

test('allows only loopback dashboard Host values and matching port', () => {
  assert.equal(isAllowedDashboardHost('127.0.0.1:49213', 49213), true);
  assert.equal(isAllowedDashboardHost('localhost:49213', 49213), true);
  assert.equal(isAllowedDashboardHost('attacker.example:49213', 49213), false);
  assert.equal(isAllowedDashboardHost('localhost.evil:49213', 49213), false);
  assert.equal(isAllowedDashboardHost('127.0.0.1:49212', 49213), false);
  assert.equal(isAllowedDashboardHost('user@localhost:49213', 49213), false);
  assert.equal(isAllowedDashboardHost(undefined, 49213), false);
});

test('inserts bootstrap JSON literally when it contains replacement tokens', () => {
  const bootstrap = JSON.stringify({ value: "$& $` $' $$" });
  const rendered = renderDashboardPage(
    '<script>const status = __INITIAL_STATUS__;</script>',
    bootstrap
  );

  assert.equal(rendered, `<script>const status = ${bootstrap};</script>`);
});
