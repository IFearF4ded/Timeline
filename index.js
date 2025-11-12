// server.js
const express = require("express");
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
    res.write(`data: ${msg.replace(/\n/g, "\\n")}\n\n`);
  }
}

app.post("/start", (req, res) => {
  if (child) {
    return res.status(409).json({ error: "Client already running" });
  }
  const { host, port, threads, seconds, payload, rate } = req.body;

  // enforce localhost only
  if (!["127.0.0.1", "localhost"].includes(host)) {
    return res.status(400).json({ error: "Only localhost targets allowed via this UI" });
  }

  const scriptPath = path.join(__dirname, "public", "main.py");
  const args = ["--mode", "client", "--host", host, "--port", String(port), "--threads", String(threads), "--seconds", String(seconds), "--payload", String(payload), "--rate", String(rate)];

  child = spawn("python", [scriptPath, ...args], { stdio: ["ignore", "pipe", "pipe"] });

  child.stdout.on("data", (chunk) => {
    const s = chunk.toString();
    sendToSSE(s);
  });
  child.stderr.on("data", (chunk) => {
    const s = chunk.toString();
    sendToSSE("[ERR] " + s);
  });
  child.on("exit", (code, sig) => {
    sendToSSE(`[child] exited code=${code} sig=${sig}`);
    child = null;
  });

  sendToSSE("[controller] started python client");
  res.json({ ok: true });
});

app.post("/stop", (req, res) => {
  if (!child) return res.json({ ok: false, msg: "no child" });
  child.kill();
  child = null;
  sendToSSE("[controller] requested stop");
  res.json({ ok: true });
});

// SSE endpoint for logs
app.get("/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  sseClients.add(res);
  res.write(": connected\n\n");
  req.on("close", () => {
    sseClients.delete(res);
  });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Controller running at http://localhost:${PORT}`));
