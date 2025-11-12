#!/usr/bin/env python3
"""
safe_local_udp.py — Local-only UDP sender + receiver for testing on your machine.

Usage (server):
  python safe_local_udp.py --mode server --port 9999

Usage (client):
  python safe_local_udp.py --mode client --host 127.0.0.1 --port 9999 --threads 8 --seconds 10 --payload 1024 --rate 0

This script refuses to send to remote hosts by default.
"""
import argparse
import socket
import threading
import time
import os
import sys

def parse_args():
    p = argparse.ArgumentParser(description="Safe local UDP tester (localhost only by default).")
    p.add_argument("--mode", choices=("server", "client"), required=True)
    p.add_argument("--host", default="127.0.0.1", help="Host to bind/connect to (default localhost)")
    p.add_argument("--port", type=int, default=9999, help="UDP port")
    p.add_argument("--threads", type=int, default=max(1, (os.cpu_count() or 4)), help="Client threads")
    p.add_argument("--seconds", type=int, default=10, help="Duration in seconds")
    p.add_argument("--payload", type=int, default=1024, help="Payload size in bytes (recommended <=65507)")
    p.add_argument("--rate", type=float, default=0.0, help="Per-thread max sends/sec (0 = no throttle)")
    p.add_argument("--allow-remote", action="store_true", help="Allow non-localhost target (unsafe)")
    return p.parse_args()

####################
# SERVER
####################
def run_server(host, port):
    if host not in ("127.0.0.1", "localhost", "0.0.0.0"):
        print("[server] WARNING: recommended to use localhost for safe tests.")
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((host, port))
    sock.settimeout(1.0)
    print(f"[server] Listening on {host}:{port} (UDP). Ctrl-C to stop.", flush=True)
    total = 0
    per_sender = {}
    start = time.time()
    try:
        while True:
            try:
                data, addr = sock.recvfrom(65535)
            except socket.timeout:
                elapsed = time.time() - start
                if elapsed > 0:
                    print(f"[server] elapsed {int(elapsed)}s — total packets {total} — pps {int(total/elapsed)}", flush=True)
                continue
            total += 1
            per_sender[addr] = per_sender.get(addr, 0) + 1
            if total % 1000 == 0:
                print(f"[server] total {total} packets; last from {addr}; sample size={len(data)} bytes", flush=True)
    except KeyboardInterrupt:
        print("\n[server] stopping. summary:", flush=True)
        elapsed = max(1.0, time.time() - start)
        print(f"  elapsed {elapsed:.1f}s, total {total}, pps {total/elapsed:.1f}", flush=True)
        for k, v in list(per_sender.items())[:10]:
            print(f"  {k} => {v} packets", flush=True)
    finally:
        sock.close()

####################
# CLIENT
####################
def run_client(host, port, threads, seconds, payload_size, rate, allow_remote):
    # safety: prevent accidental remote abuse
    if not allow_remote and host not in ("127.0.0.1", "localhost"):
        print("[client] ERROR: Unsafe target blocked. Use localhost only or pass --allow-remote (not recommended).", flush=True)
        return

    if payload_size < 1 or payload_size > 65507:
        print("[client] payload out of range (1..65507). Clamping.", flush=True)
        payload_size = max(1, min(payload_size, 65507))

    stop_event = threading.Event()
    counters = [0] * threads
    payload = b"X" * payload_size

    def worker(idx):
        nonlocal counters
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setblocking(True)
        target = (host, port)
        interval = 0.0
        if rate > 0:
            interval = 1.0 / rate
        next_time = time.perf_counter()
        error_reported = False
        while not stop_event.is_set():
            try:
                sock.sendto(payload, target)
                counters[idx] += 1
            except Exception as e:
                if not error_reported:
                    print(f"[client][t{idx}] send error: {e}", flush=True)
                    error_reported = True
                time.sleep(0.01)
            if interval > 0:
                next_time += interval
                now = time.perf_counter()
                sleep_for = next_time - now
                if sleep_for > 0:
                    time.sleep(sleep_for)
                else:
                    next_time = now

    print(f"[client] starting {threads} threads -> target {host}:{port}, payload {payload_size} bytes, rate per-thread={rate or 'max'}, duration={seconds}s", flush=True)
    thread_list = []
    for i in range(threads):
        t = threading.Thread(target=worker, args=(i,), daemon=True)
        t.start()
        thread_list.append(t)
    start = time.time()
    try:
        while time.time() - start < seconds:
            time.sleep(1)
            total = sum(counters)
            elapsed = time.time() - start
            pps = total / elapsed if elapsed > 0 else 0
            print(f"[client] elapsed {int(elapsed)}s total_packets={total} pps={pps:.1f}", flush=True)
    except KeyboardInterrupt:
        print("\n[client] interrupted by user.", flush=True)
    finally:
        stop_event.set()
        time.sleep(0.2)
        total = sum(counters)
        elapsed = max(0.001, time.time() - start)
        print(f"[client] finished. elapsed {elapsed:.2f}s total_packets={total} pps={total/elapsed:.1f}", flush=True)

####################
# CLI
####################
def main():
    args = parse_args()
    if args.mode == "server":
        run_server(args.host, args.port)
    else:
        run_client(args.host, args.port, args.threads, args.seconds, args.payload, args.rate, args.allow_remote)

if __name__ == "__main__":
    main()
