/**
 * Continuous supply heartbeat: run once, sleep 6h, repeat.
 * Mirrors docker compose supply-heartbeat entrypoint for host/PM2.
 */
require('dotenv').config();

const INTERVAL_MS = Number(process.env.SUPPLY_HEARTBEAT_INTERVAL_MS) || 6 * 60 * 60 * 1000;

async function tick() {
  try {
    const { runSupplyHeartbeat } = require('./supplyHeartbeat');
    if (typeof runSupplyHeartbeat === 'function') {
      await runSupplyHeartbeat({ alertOnlyOnFail: true });
    } else {
      // CLI-style module: spawn as child for side effects
      const { spawnSync } = require('child_process');
      const r = spawnSync(
        process.execPath,
        ['src/jobs/supplyHeartbeat.js', '--alert-only-on-fail'],
        { cwd: require('path').join(__dirname, '../..'), stdio: 'inherit', env: process.env }
      );
      if (r.status !== 0) {
        console.error('supplyHeartbeat exited', r.status);
      }
    }
  } catch (error) {
    console.error('supplyHeartbeatLoop error:', error.message);
  }
}

(async function main() {
  console.log(`Supply heartbeat loop started (interval ${INTERVAL_MS / 3600000}h)`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await tick();
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
})();
