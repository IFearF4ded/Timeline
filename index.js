// local_flood.js
// Real UDP sender for localhost only. ES module style (requires package.json "type":"module" or run with `node --input-type=module`).
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
    perThreadDelayMs: Number(get("delay", 0)) // optional small delay to avoid burning system
  };
}

// Safety caps
const HARD_MAX_THREADS = 512;
const SUGGESTED_MAX = Math.max(4, (os.cpus().length || 4) * 8);

function isLocalhost(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

async function main() {
  const cfg = parseArgs();

  if (cfg.threads > HARD_MAX_THREADS) {
    console.warn(`Requested threads (${cfg.threads}) exceeds hard cap ${HARD_MAX_THREADS}. Clamping.`);
    cfg.threads = HARD_MAX_THREADS;
  } else if (cfg.threads > SUGGESTED_MAX) {
    console.warn(`Requested threads (${cfg.threads}) > suggested max (${SUGGESTED_MAX}). Proceeding but be careful.`);
  }

  console.log(`Starting UDP sender → ${cfg.target}:${cfg.port}`);
  console.log(`threads=${cfg.threads} seconds=${cfg.seconds} payload=${cfg.payloadSize}B delay_per_send_ms=${cfg.perThreadDelayMs}`);

  const payload = Buffer.alloc(cfg.payloadSize, "X");
  const sockets = [];
  const counters = new Array(cfg.threads).fill(0);
  let running = true;

  // Graceful stop on Enter or SIGINT
  readline.createInterface({ input: process.stdin, output: process.stdout })
    .question("Press Enter to stop early...\n", () => { running = false; });

  process.on("SIGINT", () => { running = false; });

  // Worker function: sends in an async loop using setImmediate (tight) or setTimeout (throttled)
  function startSender(threadIndex) {
    const s = dgram.createSocket("udp4");
    sockets.push(s);
    const sendOnce = () => {
      if (!running) return;
      s.send(payload, cfg.port, cfg.target, (err) => {
        if (err) {
          // print first error then continue
          console.error(`[t${threadIndex}] send error:`, err.message || err);
        }
        counters[threadIndex]++;
        if (cfg.perThreadDelayMs > 0) {
          setTimeout(sendOnce, cfg.perThreadDelayMs);
        } else {
          // next tick ASAP
          setImmediate(sendOnce);
        }
      });
    };
    sendOnce();
  }

  // spawn threads
  for (let i = 0; i < cfg.threads; i++) {
    startSender(i);
  }

  // Status interval
  const startTime = Date.now();
  const statusInt = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    const total = counters.reduce((a, b) => a + b, 0);
    const pps = (elapsed > 0) ? Math.round(total / elapsed) : total;
    process.stdout.write(`\rElapsed: ${Math.floor(elapsed)}s  Threads: ${cfg.threads}  Sent: ${total}  ~pps:${pps}    `);
  }, 1000);

  // Stop after duration
  const stopAt = Date.now() + cfg.seconds * 1000;
  while (running && Date.now() < stopAt) {
    // sleep small to allow ctrl+c / Enter to set running=false
    await new Promise(r => setTimeout(r, 200));
  }

  // shutdown
  running = false;
  clearInterval(statusInt);
  console.log("\nStopping... waiting a moment for sockets to close.");
  // close sockets
  for (const s of sockets) {
    try { s.close(); } catch (_) {}
  }
  const total = counters.reduce((a, b) => a + b, 0);
  const elapsed = Math.max(0.001, (Date.now() - startTime) / 1000);
  console.log(`Finished. elapsed=${elapsed.toFixed(2)}s total_sent=${total} pps=${(total / elapsed).toFixed(1)}`);
  process.exit(0);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
