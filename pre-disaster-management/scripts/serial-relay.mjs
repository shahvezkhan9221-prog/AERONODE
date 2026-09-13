import { SerialPort, ReadlineParser } from "serialport";
// Optional fallback for browsers without Web Serial. Run one process per directly
// connected sensor ESP32, with a different SERIAL_PORT in each terminal.
const path = process.env.SERIAL_PORT;
const token = process.env.GATEWAY_TOKEN;
const url = process.env.DASHBOARD_URL || "http://localhost:3000";
if (!path || !token) {
  console.error(
    "Set SERIAL_PORT and GATEWAY_TOKEN. Optional: DASHBOARD_URL and SERIAL_BAUD (default 115200).",
  );
  console.info("Available serial ports:", await SerialPort.list());
  process.exit(1);
}
const port = new SerialPort({
  path,
  baudRate: Number(process.env.SERIAL_BAUD || 115200),
});
const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));
port.on("open", () =>
  console.info(
    `SENTINEL-MESH listening on ${path}; forwarding to ${url}/api/ingest`,
  ),
);
port.on("error", (error) => {
  console.error("Serial error:", error.message);
  process.exitCode = 1;
});
parser.on("data", async (line) => {
  try {
    const packet = JSON.parse(line.trim());
    // Gateway receipt time is assigned here; a valid supplied UTC timestamp is preserved.
    packet.timestamp ??= new Date().toISOString();
    const response = await fetch(`${url.replace(/\/$/, "")}/api/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(packet),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok)
      throw new Error(`${response.status} ${await response.text()}`);
    console.info(`${packet.timestamp} ${packet.nodeId}: accepted`);
  } catch (error) {
    console.error("Packet rejected:", error.message);
  }
});
process.on("SIGINT", () => {
  port.close(() => process.exit(0));
});
