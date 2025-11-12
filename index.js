// local_flood_fixed.js
import dgram from "dgram";
import os from "os";
import readline from "readline";
import { argv } from "process";

function parseArgs() {
  const get = (name, fallback) => {
    const idx = argv.indexOf(`--${name}`);
    if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
    return fallback;
  };
  return {
    target: get("target", "127.0.0.1"),
    port: Number(get("port", 9999)),
    threads: Math.max(1, Number(get("threads", os.cpus().length || 4))),
    seconds: Math.max(1, Number(get("seconds", 10))),
    payloadSize: Math.max(1, Math.min(Number(get("payload", 1024)), 65507)),
    delayMs: Number(get("delay", 0)),
  };
}

async function main() {
  const cfg = parseArgs();
  const HARD_MAX_THREADS = 512;
  const SUGGESTED_MAX = Math.max(4, (os.cpus().length || 4) * 8);

  if (cfg.threads > HARD_MAX_THREADS) cfg.threads = HARD_MAX_THREADS;
  else if (cfg.threads > SUGGESTED_MAX) console.warn(`[!] Threads > suggested max (${SUGGESTED_MAX})`);

  console.log(`Starting UDP sender → ${cfg.target}:${cfg.port}`);
  console.log(`threads=${cfg.threads} seconds=${cfg.seconds} payload=${cfg.payloadSize}B delay=${cfg.delayMs}ms`);

  const payload = Buffer.alloc(cfg.payloadSize, "X");
  const counters = new Array(cfg.threads).fill(0);
  let running = true;

  // Stop early on Enter or SIGINT
  readline.createInterface({ input: process.stdin, output: process.stdout })
    .on("line", () => { running = false; });
  process.on("SIGINT", () => { running = false; });

  function startSender(idx) {
    const socket = dgram.createSocket("udp4");
    const sendLoop = () => {
      if (!running) return socket.close();
      socket.send(payload, cfg.port, cfg.target, (err) => {
        if (err) console.error(`[t${idx}] send error:`, err.message || err);
        counters[idx]++;
        if (cfg.delayMs > 0) setTimeout(sendLoop, cfg.delayMs);
        else setImmediate(sendLoop);
      });
    };
    sendLoop();
  }

  for (let i = 0; i < cfg.threads; i++) startSender(i);

  const startTime = Date.now();
  const statusInterval = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    const total = counters.reduce((a, b) => a + b, 0);
    process.stdout.write(`\rElapsed: ${Math.floor(elapsed)}s | Sent: ${total} | ~pps:${Math.round(total/elapsed)}   `);
  }, 1000);

  // Stop after duration
  while (running && (Date.now() - startTime) < cfg.seconds * 1000) {
    await new Promise(r => setTimeout(r, 200));
  }

  running = false;
  clearInterval(statusInterval);

  const totalSent = counters.reduce((a, b) => a + b, 0);
  const elapsed = Math.max(0.001, (Date.now() - startTime) / 1000);
  console.log(`\nFinished. elapsed=${elapsed.toFixed(2)}s total_sent=${totalSent} pps=${(totalSent/elapsed).toFixed(1)}`);
  process.exit(0);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
