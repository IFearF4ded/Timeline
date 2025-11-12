import express from "express";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import bodyParser from "body-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

let child = null;
let sseClients = new Set();

function sendToSSE(msg) {
  for (const res of sseClients) {
    try { res.write(`data: ${msg.replace(/\n/g, "\\n")}\n\n`); } catch {}
  }
}

function sanitizeNumber(n, fallback) {
  const val = Number(n);
  return Number.isFinite(val) ? Math.round(val) : fallback;
}

function isLocalhost(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

// Start process
app.post("/start", (req, res) => {
  if (child) return res.status(409).json({ ok: false, error: "Process already running" });

  const body = req.body || {};
  const host = String(body.host || "127.0.0.1").trim();
  const port = sanitizeNumber(body.port, 9999);
  let threads = sanitizeNumber(body.threads, 4);
  let seconds = sanitizeNumber(body.seconds, 10);
  let payload = sanitizeNumber(body.payload, 1024);
  let delay = sanitizeNumber(body.delay, 0);

  if (!isLocalhost(host)) return res.status(400).json({ ok: false, error: "Only localhost targets allowed" });

  const scriptPath = path.join(__dirname, "local_flood_fixed.js");
  const args = [
    "--target", host,
    "--port", String(port),
    "--threads", String(threads),
    "--seconds", String(seconds),
    "--payload", String(payload),
    "--delay", String(delay)
  ];

  try {
    child = spawn(process.execPath, [scriptPath, ...args], { stdio: ["ignore", "pipe", "pipe"] });

    child.stdout.on("data", chunk => sendToSSE(chunk.toString()));
    child.stderr.on("data", chunk => sendToSSE("[ERR] " + chunk.toString()));
    child.on("exit", (code) => { sendToSSE(`[PROCESS EXIT] code=${code}`); child=null; });

    sendToSSE("[controller] started process");
    res.json({ ok: true });
  } catch (err) {
    child = null;
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Stop process
app.post("/stop", (req, res) => {
  if (!child) return res.json({ ok: false, error: "No process running" });
  try { child.kill(); sendToSSE("[controller] stop requested"); child=null; res.json({ ok: true }); }
  catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

// SSE logs
app.get("/events", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  sseClients.add(res);
  res.write(": connected\n\n");
  req.on("close", () => sseClients.delete(res));
});

// Status
app.get("/status", (req, res) => res.json({ running: !!child }));

app.listen(3000, () => console.log("Controller running at http://localhost:3000"));
