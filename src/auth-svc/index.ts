/**
 * web3-auth-svc — HTTPS signing server for OPNet ML-DSA authentication.
 *
 * Serves the signing page and provides callback endpoints for the PAM module's
 * session-based authentication flow. Verifies ML-DSA signatures and derives
 * wallet addresses. Compiled to a standalone bundle for deployment on VMs.
 *
 * Routes:
 *   GET /                           — Serve signing page HTML
 *   GET /auth/pending/:session_id   — Return session JSON from pending dir
 *   POST /auth/callback/:session_id — Verify ML-DSA signature, write .sig file
 *
 * Config: /etc/web3-auth/config.toml (TOML, [https] section)
 *
 * SPECIAL profile: S7 P9 E8 C5 I7 A7 L7
 *   P9: Auth boundary — validate every input, trust nothing from the network.
 *   E8: Long-running daemon — must not crash, must not leak.
 */

import * as https from "node:https";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import { ml_dsa44, ml_dsa65, ml_dsa87 } from "@btc-vision/post-quantum/ml-dsa.js";

// ── Constants ──────────────────────────────────────────────────────────

const DEFAULT_PENDING_DIR = "/run/libpam-web3/pending";
let PENDING_DIR = DEFAULT_PENDING_DIR;
const MAX_BODY_SIZE = 16_384;
const DEFAULT_CONFIG_PATH = "/etc/web3-auth/config.toml";

const SESSION_ID_RE = /^[0-9a-f]{32}$/;
const BASE64_RE = /^[A-Za-z0-9+/]+=*$/;

// ── ML-DSA Parameter Tables ───────────────────────────────────────────

interface MLDSALevel {
  sigSize: number;
  verify: (sig: Uint8Array, msg: Uint8Array, publicKey: Uint8Array) => boolean;
  name: string;
}

/** Key: public key byte length. Value: expected signature size + verify function. */
const MLDSA_LEVELS: ReadonlyMap<number, MLDSALevel> = new Map([
  [1312, { sigSize: 2420, verify: ml_dsa44.verify, name: "ML-DSA-44" }],
  [1952, { sigSize: 3309, verify: ml_dsa65.verify, name: "ML-DSA-65" }],
  [2592, { sigSize: 4627, verify: ml_dsa87.verify, name: "ML-DSA-87" }],
]);

// ── Config ─────────────────────────────────────────────────────────────

interface HttpsConfig {
  port: number;
  bind: string;
  cert_path: string;
  key_path: string;
  signing_page_path: string;
  pending_dir: string;
}

/**
 * Minimal TOML parser for the [https] section. Handles string values,
 * integers, and single-line string arrays. No external dependencies.
 */
function parseToml(content: string): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  let section = "";

  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const secMatch = line.match(/^\[([a-zA-Z_][a-zA-Z0-9_]*)\]$/);
    if (secMatch?.[1]) {
      section = secMatch[1];
      result[section] = result[section] || {};
      continue;
    }

    const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
    if (!kvMatch?.[1] || !kvMatch[2] || !section) continue;

    const key = kvMatch[1];
    const val = kvMatch[2].trim();

    if (val.startsWith('"') && val.endsWith('"')) {
      result[section]![key] = val.slice(1, -1);
    } else if (val.startsWith("[")) {
      const inner = val.slice(1, val.lastIndexOf("]"));
      result[section]![key] = inner
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s));
    } else {
      const num = Number(val);
      result[section]![key] = Number.isNaN(num) ? val : num;
    }
  }

  return result;
}

function loadConfig(configPath: string): HttpsConfig {
  const content = fs.readFileSync(configPath, "utf8");
  const toml = parseToml(content);
  const sec = toml["https"];

  if (!sec) {
    throw new Error(`missing [https] section in ${configPath}`);
  }

  const port = typeof sec.port === "number" ? sec.port : 8443;
  const bind =
    Array.isArray(sec.bind) && sec.bind.length > 0 ? String(sec.bind[0]) : "::";
  const cert_path = String(sec.cert_path || "");
  const key_path = String(sec.key_path || "");
  const signing_page_path = String(
    sec.signing_page_path || "/usr/share/blockhost/signing-page/index.html"
  );
  const pending_dir = String(sec.pending_dir || DEFAULT_PENDING_DIR);

  if (!cert_path) throw new Error("https.cert_path is required");
  if (!key_path) throw new Error("https.key_path is required");

  return { port, bind, cert_path, key_path, signing_page_path, pending_dir };
}

// ── Validation & Decoding ─────────────────────────────────────────────

function isValidSessionId(id: string): boolean {
  return SESSION_ID_RE.test(id);
}

function decodeBase64(str: string): Buffer | null {
  if (!str || !BASE64_RE.test(str)) return null;
  const buf = Buffer.from(str, "base64");
  if (buf.length === 0) return null;
  return buf;
}

interface CallbackPayload {
  signature: string;
  publicKey: string;
  otp: string;
  machineId: string;
}

/**
 * Parse and validate the callback POST body. Rejects unknown fields.
 * Payload is self-describing: signature + publicKey + otp + machineId.
 * The verifier can reconstruct the signed message and derive the wallet
 * address without any external state.
 */
function parseCallbackBody(body: string): CallbackPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;
  const keys = Object.keys(obj);

  if (keys.length !== 4) return null;
  if (typeof obj["signature"] !== "string") return null;
  if (typeof obj["publicKey"] !== "string") return null;
  if (typeof obj["otp"] !== "string") return null;
  if (typeof obj["machineId"] !== "string") return null;

  // Sanity: OTP should be short numeric, machineId should be reasonable length
  if (obj["otp"].length > 16 || obj["machineId"].length > 128) return null;

  return {
    signature: obj["signature"],
    publicKey: obj["publicKey"],
    otp: obj["otp"],
    machineId: obj["machineId"],
  };
}

interface SessionData {
  otp: string;
  machine_id: string;
}

function loadSession(sessionId: string): SessionData | null {
  const jsonPath = path.join(PENDING_DIR, `${sessionId}.json`);
  try {
    const content = fs.readFileSync(jsonPath, "utf8");
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj["otp"] !== "string" || typeof obj["machine_id"] !== "string") {
      return null;
    }
    return { otp: obj["otp"], machine_id: obj["machine_id"] };
  } catch {
    return null;
  }
}

// ── ML-DSA Verification Pipeline ──────────────────────────────────────

/**
 * Verify an ML-DSA signed authentication callback and write the .sig file.
 *
 * Returns null on success, or an error string describing the failure.
 * Error strings are safe to log but must NOT be returned to the client
 * (they may reveal internal state).
 */
function verifyAndWriteSig(sessionId: string, payload: CallbackPayload): string | null {
  // Decode base64 fields
  const sigBytes = decodeBase64(payload.signature);
  const pubKeyBytes = decodeBase64(payload.publicKey);
  if (!sigBytes) return "invalid base64 in signature field";
  if (!pubKeyBytes) return "invalid base64 in publicKey field";

  // Determine ML-DSA level from public key size
  const level = MLDSA_LEVELS.get(pubKeyBytes.length);
  if (!level) return `unrecognized public key size: ${pubKeyBytes.length} bytes`;

  // Validate signature size matches the detected level
  if (sigBytes.length !== level.sigSize) {
    return `signature size ${sigBytes.length} does not match ${level.name} (expected ${level.sigSize})`;
  }

  // Prevent overwrite of existing .sig (first-claim-wins)
  const sigPath = path.join(PENDING_DIR, `${sessionId}.sig`);
  if (fs.existsSync(sigPath)) return "session already processed";

  // Load session data and cross-check against payload
  const session = loadSession(sessionId);
  if (!session) return "session not found or malformed";

  if (!timingSafeEqual(Buffer.from(payload.otp), Buffer.from(session.otp))) return "otp mismatch";
  if (payload.machineId !== session.machine_id) return "machine_id mismatch";

  // Reconstruct signed message from payload fields and SHA256 hash it
  // The signing page hashes this same message before passing to wallet.web3.signMLDSAMessage
  const message = `Authenticate to ${payload.machineId} with code: ${payload.otp}`;
  const messageHash = createHash("sha256").update(message).digest();

  // The signing page passes hex(SHA256(message)) to wallet.web3.signMLDSAMessage().
  // The wallet internally SHA256-hashes the hex string it receives, so the actual
  // signed data is SHA256(hex(SHA256(message))). We must reproduce this double-hash.
  const walletInput = messageHash.toString("hex");
  const signedHash = createHash("sha256").update(walletInput).digest();

  // Verify ML-DSA signature
  let isValid: boolean;
  try {
    isValid = level.verify(
      new Uint8Array(sigBytes),
      new Uint8Array(signedHash),
      new Uint8Array(pubKeyBytes)
    );
  } catch (err) {
    return `${level.name} verify threw: ${err instanceof Error ? err.message : String(err)}`;
  }

  if (!isValid) return "signature verification failed";

  // Derive wallet address: 0x + hex(SHA256(publicKey))
  const walletAddress = "0x" + createHash("sha256").update(pubKeyBytes).digest("hex");

  // Build .sig content — self-describing, verifiable without session file
  const sigContent = JSON.stringify({
    otp: payload.otp,
    machine_id: payload.machineId,
    wallet_address: walletAddress,
  });

  // Atomic write: tmp → rename
  const tmpPath = path.join(PENDING_DIR, `${sessionId}.sig.tmp`);
  try {
    fs.writeFileSync(tmpPath, sigContent);
    fs.renameSync(tmpPath, sigPath);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // tmp may not exist
    }
    return `sig file write failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  console.log(
    `[AUTH] Verified ${level.name} signature for session ${sessionId} → ${walletAddress}`
  );
  return null;
}

// ── Route Handlers ────────────────────────────────────────────────────

function sendResponse(
  res: import("node:http").ServerResponse,
  status: number,
  body: string,
  contentType = "text/plain"
): void {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(body);
}

function handleGetPending(
  sessionId: string,
  res: import("node:http").ServerResponse
): void {
  if (!isValidSessionId(sessionId)) {
    sendResponse(res, 404, "Not Found");
    return;
  }

  const jsonPath = path.join(PENDING_DIR, `${sessionId}.json`);

  let contents: string;
  try {
    contents = fs.readFileSync(jsonPath, "utf8");
  } catch {
    sendResponse(res, 404, "Not Found");
    return;
  }

  sendResponse(res, 200, contents, "application/json");
}

function handlePostCallback(
  sessionId: string,
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse
): void {
  if (!isValidSessionId(sessionId)) {
    sendResponse(res, 404, "Not Found");
    return;
  }

  // Content-Type must be JSON
  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("application/json")) {
    sendResponse(res, 400, "Content-Type must be application/json");
    return;
  }

  const chunks: Buffer[] = [];
  let bodySize = 0;
  let aborted = false;

  req.on("data", (chunk: Buffer) => {
    bodySize += chunk.length;
    if (bodySize > MAX_BODY_SIZE) {
      if (!aborted) {
        aborted = true;
        sendResponse(res, 413, "body too large");
        req.destroy();
      }
      return;
    }
    chunks.push(chunk);
  });

  req.on("end", () => {
    if (aborted) return;

    const body = Buffer.concat(chunks).toString("utf8").trim();

    // Parse and validate JSON structure
    const payload = parseCallbackBody(body);
    if (!payload) {
      sendResponse(res, 400, "invalid request body");
      return;
    }

    // Verify signature and write .sig file
    const error = verifyAndWriteSig(sessionId, payload);

    if (error === null) {
      sendResponse(res, 200, "OK");
    } else if (error === "session already processed") {
      sendResponse(res, 409, "Conflict");
    } else if (error === "session not found or malformed") {
      sendResponse(res, 404, "Not Found");
    } else {
      // All other errors: log internally, return generic 400 to client.
      // P9: never leak internal error details to the network.
      console.error(`[AUTH] Callback rejected for session ${sessionId}: ${error}`);
      sendResponse(res, 400, "verification failed");
    }
  });

  req.on("error", () => {
    // Connection closed by client
  });
}

// ── Server ────────────────────────────────────────────────────────────

function main(): void {
  const configPath = process.argv[2] || DEFAULT_CONFIG_PATH;
  const config = loadConfig(configPath);
  PENDING_DIR = config.pending_dir;

  let signingPageHtml: string;
  try {
    signingPageHtml = fs.readFileSync(config.signing_page_path, "utf8");
  } catch (err) {
    console.error(
      `Failed to read signing page: ${config.signing_page_path}: ${err}`
    );
    process.exit(1);
  }

  const tlsOptions: https.ServerOptions = {
    cert: fs.readFileSync(config.cert_path),
    key: fs.readFileSync(config.key_path),
  };

  const server = https.createServer(tlsOptions, (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");

    const url = new URL(req.url || "/", "https://localhost");
    const pathname = url.pathname;

    // GET / — serve signing page
    if (req.method === "GET" && pathname === "/") {
      sendResponse(res, 200, signingPageHtml, "text/html; charset=utf-8");
      return;
    }

    // GET /auth/pending/:session_id
    const pendingMatch = pathname.match(/^\/auth\/pending\/([^/]+)$/);
    if (req.method === "GET" && pendingMatch?.[1]) {
      handleGetPending(pendingMatch[1], res);
      return;
    }

    // POST /auth/callback/:session_id
    const callbackMatch = pathname.match(/^\/auth\/callback\/([^/]+)$/);
    if (req.method === "POST" && callbackMatch?.[1]) {
      handlePostCallback(callbackMatch[1], req, res);
      return;
    }

    sendResponse(res, 404, "Not Found");
  });

  server.listen(config.port, config.bind, () => {
    console.log(
      `[AUTH] web3-auth-svc listening on [${config.bind}]:${config.port}`
    );
    console.log(`[AUTH] Signing page: ${config.signing_page_path}`);
    console.log(`[AUTH] Pending dir: ${PENDING_DIR}`);
  });

  server.on("error", (err) => {
    console.error(`[AUTH] Server error: ${err}`);
    process.exit(1);
  });

  process.on("SIGTERM", () => {
    console.log("[AUTH] Shutting down...");
    server.close(() => process.exit(0));
  });

  process.on("SIGINT", () => {
    console.log("[AUTH] Shutting down...");
    server.close(() => process.exit(0));
  });
}

main();
