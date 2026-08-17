import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const key = randomBytes(32);
const keyLines = Array.from({ length: 4 }, (_, row) =>
  "  " + Array.from(key.subarray(row * 8, row * 8 + 8), byte => `0x${byte.toString(16).padStart(2, "0")}`).join(", ")
).join(",\n");

function nodeId() {
  let value = 0;
  while (value === 0) value = randomBytes(4).readUInt32BE(0);
  return `0x${value.toString(16).padStart(8, "0").toUpperCase()}`;
}

function header(id) {
  return `#pragma once\n\nstatic const uint8_t AERO_NETWORK_KEY[32] = {\n${keyLines}\n};\n\nstatic const uint32_t AERO_NODE_ID = ${id};\n`;
}

const masterPath = resolve(projectRoot, "firmware/aero_network_secrets.h");
const peerDirectory = resolve(projectRoot, "firmware/secure_peer_example");
const peerPath = resolve(peerDirectory, "aero_network_secrets.h");
await mkdir(peerDirectory, { recursive: true });
await writeFile(masterPath, header(nodeId()), { mode: 0o600 });
await writeFile(peerPath, header(nodeId()), { mode: 0o600 });
process.stdout.write("Created matching AES-256 keys with unique node IDs for the master and secure peer.\n");
