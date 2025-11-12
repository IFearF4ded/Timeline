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

function isLocalhost(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

async function main() {
  const cfg = parseArgs();

  // Safety: enforce localhost-only
  if (!isLocalhost(cfg.target)) {
    console.error("[ERROR] target must be localhost (127.0.0.1). Aborting.");
    process.exit(1);
  }

  const HARD_MAX_THREADS = 512;
  const SUGGESTED_MAX = Math.max(4, (os.cpus().length || 4) * 8);

  if (cfg.threads > HARD_MAX_THREADS) {
    console.warn(`[WARN] Requested threads (${cfg.threads}) exceeds hard cap ${HARD_MAX_THREADS}. Clamping.`);
    cfg.threads = HARD_MAX_THREADS;
  } else if (cfg.threads > SUGGESTED_MAX) {
    console.warn(`[WARN] Threads (${cfg.threads}) > suggested (${SUGGESTED_MAX}).`);
  }

  console.log(`Starting UDP sender -> ${cfg.target}:${cfg.port}`);
  console.log(`threads=${cfg.threads} seconds=${cfg.seconds} payload=${cfg.payloadSize}B delay=${cfg.delayMs}ms`);

  const payload = Buffer.alloc(cfg.payloadSize, "X");
  const counters = new Array(cfg.threads).fill(0);
  let running = true;

  // Stop early on Enter or SIGINT
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on("line", () => { running = false; });
  process.on("SIGINT", () => { running = false; });

  // start a sender loop for a thread index
  function startSender(idx) {
    const sock = dgram.createSocket("udp4");

    function loop() {
      if (!running) {
        try { sock.close(); } catch(_) {}
        return;
      }

      sock.send(payload, cfg.port, cfg.target, (err) => {
        if (err) {
          // print error once per thread to avoid spam
          console.error(`[t${idx}] send error:`, err.message || err);
        }
        counters[idx]++;

        if (cfg.delayMs > 0) {
          setTimeout(loop, cfg.delayMs);
        } else {
          // tight, but cooperative loop
          setImmediate(loop);
        }
      });
    }

    // start the loop
    loop();
  }

  // spawn threads
  for (let i = 0; i < cfg.threads; i++) startSender(i);

  // status reporter
  const startTime = Date.now();
  const statusI = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    const total = counters.reduce((a,b)=>a+b,0);
    const pps = elapsed > 0 ? Math.round(total / elapsed) : total;
    process.stdout.write(`\rElapsed: ${Math.floor(elapsed)}s  Sent: ${total}  ~pps:${pps}    `);
  }, 1000);

  // stop after duration or when running=false
  const stopAt = Date.now() + cfg.seconds * 1000;
  while (running && Date.now() < stopAt) {
    await new Promise(r => setTimeout(r, 200));
  }

  // shutdown
  running = false;
  clearInterval(statusI);
  const total = counters.reduce((a,b)=>a+b,0);
  const elapsed = Math.max(0.001, (Date.now() - startTime) / 1000);
  console.log(`\nFinished. elapsed=${elapsed.toFixed(2)}s total_sent=${total} pps=${(total/elapsed).toFixed(1)}`);
  process.exit(0);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
