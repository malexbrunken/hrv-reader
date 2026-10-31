// src/server/sessionsFunction.ts
import { get, put } from "@vercel/blob";

// src/cloud/auth.ts
import { createHash, timingSafeEqual } from "node:crypto";

// src/cloud/header.ts
var PASSPHRASE_HEADER = "x-hrv-passphrase";

// src/cloud/auth.ts
function passphrasesMatch(provided, expected) {
  const providedHash = createHash("sha256").update(provided, "utf8").digest();
  const expectedHash = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(providedHash, expectedHash);
}
function authorizePassphrase(provided, expected) {
  if (expected == null || expected.trim() === "") return "unconfigured";
  if (provided == null) return "unauthorized";
  return passphrasesMatch(provided, expected) ? "ok" : "unauthorized";
}
function headerValue(headers, name) {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw ?? null;
}

// src/hrv/stats.ts
function median(values) {
  if (values.length === 0) throw new Error("Cannot take the median of an empty list.");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  const left = sorted[mid - 1] ?? 0;
  const right = sorted[mid] ?? 0;
  return (left + right) / 2;
}

// src/hrv/filter.ts
var RR_MIN_MS = 300;
var RR_MAX_MS = 2e3;
var MEDIAN_DEVIATION = 0.2;
var MEDIAN_RADIUS = 2;
function filterRrIntervals(rr) {
  const total = rr.length;
  const inRange = rr.map((value) => value >= RR_MIN_MS && value <= RR_MAX_MS);
  const accepted = [];
  const acceptedIndex = [];
  for (let i = 0; i < rr.length; i++) {
    if (!inRange[i]) continue;
    const value = rr[i];
    if (value == null) continue;
    const window = [];
    const start = Math.max(0, i - MEDIAN_RADIUS);
    const end = Math.min(rr.length - 1, i + MEDIAN_RADIUS);
    for (let j = start; j <= end; j++) {
      if (j === i || !inRange[j]) continue;
      const neighbor = rr[j];
      if (neighbor != null) window.push(neighbor);
    }
    if (window.length > 0) {
      const mid = median(window);
      if (!(mid > 0) || Math.abs(value - mid) / mid > MEDIAN_DEVIATION) continue;
    }
    accepted.push(value);
    acceptedIndex.push(i);
  }
  const removedCount = total - accepted.length;
  return {
    accepted,
    acceptedIndex,
    removedCount,
    removedPct: total === 0 ? 0 : removedCount / total * 100,
    total
  };
}

// src/storage/sessions.ts
var ROLLING_WINDOW_MS = 7 * 24 * 60 * 60 * 1e3;
function finiteOrNull(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
function tagValue(value) {
  const parsed = finiteOrNull(value);
  if (parsed == null || !Number.isInteger(parsed) || parsed < 1 || parsed > 5) return null;
  return parsed;
}
function numberList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => finiteOrNull(item)).filter((item) => item != null);
  }
  if (typeof value === "string") return parseRrCell(value);
  return [];
}
function parseRrCell(cell) {
  if (!cell.trim()) return [];
  return cell.split(/[|;]/).map((part) => Number(part.trim())).filter((value) => Number.isFinite(value));
}
function sanitizeSession(value) {
  if (value == null || typeof value !== "object") return null;
  const row = value;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const startedAt = typeof row.startedAt === "string" ? row.startedAt : "";
  if (!id || !Number.isFinite(Date.parse(startedAt))) return null;
  const duration = finiteOrNull(row.durationSec);
  if (duration == null || duration < 0) return null;
  const source = row.source === "demo" ? "demo" : "bluetooth";
  const rawRr = numberList(row.rawRr);
  const filteredGiven = numberList(row.filteredRr);
  const tagsRaw = row.tags;
  const tagsObj = tagsRaw != null && typeof tagsRaw === "object" ? tagsRaw : {};
  const notes = typeof tagsObj.notes === "string" ? tagsObj.notes.slice(0, 2e3) : "";
  const tags = {
    sleep: tagValue(tagsObj.sleep),
    soreness: tagValue(tagsObj.soreness),
    stress: tagValue(tagsObj.stress),
    notes
  };
  const deviceName = typeof row.deviceName === "string" && row.deviceName.trim() ? row.deviceName : null;
  const battery = finiteOrNull(row.batteryPercent);
  const beatsTotal = finiteOrNull(row.beatsTotal);
  return {
    id,
    startedAt,
    durationSec: duration,
    source,
    deviceName,
    batteryPercent: battery != null && battery >= 0 && battery <= 100 ? Math.round(battery) : null,
    meanHr: finiteOrNull(row.meanHr),
    rmssd: finiteOrNull(row.rmssd),
    lnRmssd: finiteOrNull(row.lnRmssd),
    score: finiteOrNull(row.score),
    sdnn: finiteOrNull(row.sdnn),
    pnn50: finiteOrNull(row.pnn50),
    lf: finiteOrNull(row.lf),
    hf: finiteOrNull(row.hf),
    lfHf: finiteOrNull(row.lfHf),
    lfHfReliable: row.lfHfReliable === true || row.lfHfReliable === "true",
    sd1: finiteOrNull(row.sd1),
    sd2: finiteOrNull(row.sd2),
    beatsTotal: beatsTotal != null && beatsTotal >= 0 ? beatsTotal : rawRr.length,
    beatsRemovedPct: finiteOrNull(row.beatsRemovedPct) ?? 0,
    rawRr,
    filteredRr: filteredGiven.length > 0 || rawRr.length === 0 ? filteredGiven : filterRrIntervals(rawRr).accepted,
    tags
  };
}
function emptySnapshot() {
  return { sessions: [], tombstones: [] };
}
function mergeTombstones(local, remote) {
  const byId = /* @__PURE__ */ new Map();
  for (const tombstone of [...remote, ...local]) {
    if (!tombstone.id || !Number.isFinite(Date.parse(tombstone.deletedAt))) continue;
    const previous = byId.get(tombstone.id);
    if (!previous || Date.parse(tombstone.deletedAt) >= Date.parse(previous.deletedAt)) {
      byId.set(tombstone.id, { id: tombstone.id, deletedAt: tombstone.deletedAt });
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
function applyTombstones(sessions, tombstones) {
  if (tombstones.length === 0) return sessions;
  const dead = new Set(tombstones.map((tombstone) => tombstone.id));
  return sessions.filter((session) => !dead.has(session.id));
}
function snapshotToJson(snapshot) {
  return `${JSON.stringify(
    {
      app: "hrv-reader",
      version: 1,
      sessions: snapshot.sessions,
      tombstones: snapshot.tombstones
    },
    null,
    2
  )}
`;
}
function parseSnapshot(text) {
  const sessions = parseJsonSessions(text);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { sessions, tombstones: [] };
  }
  const tombstoneList = parsed != null && typeof parsed === "object" && Array.isArray(parsed.tombstones) ? parsed.tombstones : [];
  const tombstones = tombstoneList.map(sanitizeTombstone).filter((tombstone) => tombstone != null);
  return { sessions: applyTombstones(sessions, tombstones), tombstones: mergeTombstones(tombstones, []) };
}
function sanitizeTombstone(value) {
  if (value == null || typeof value !== "object") return null;
  const row = value;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const deletedAt = typeof row.deletedAt === "string" ? row.deletedAt : "";
  if (!id || !Number.isFinite(Date.parse(deletedAt))) return null;
  return { id, deletedAt };
}
function parseJsonSessions(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  const list = Array.isArray(parsed) ? parsed : parsed != null && typeof parsed === "object" && Array.isArray(parsed.sessions) ? parsed.sessions : null;
  if (list == null) throw new Error("JSON should be a list of sessions, or an object with a sessions list.");
  return list.map((item, index) => {
    if (item == null || typeof item !== "object") return null;
    const row = item;
    const id = typeof row.id === "string" && row.id.trim() ? row.id : `imported-${index}`;
    return sanitizeSession({ ...row, id });
  }).filter((session) => session != null);
}

// src/cloud/sessionsApi.ts
var CLOUD_BLOB_PATH = "hrv/9f3c1a7e4b28d0c65a1e7f94b2d8c0e6.json";
async function handleSessionsRequest(request) {
  if (!request.blobConfigured) {
    return json(503, { error: "Cloud sync is not configured. Set BLOB_READ_WRITE_TOKEN." });
  }
  const auth = authorizePassphrase(headerValue(request.headers, PASSPHRASE_HEADER), request.expectedPassphrase);
  if (auth === "unconfigured") {
    return json(503, { error: "Cloud sync is not configured. Set HRV_PASSPHRASE." });
  }
  if (auth === "unauthorized") return json(401, { error: "Unauthorized." });
  if (request.method === "GET") {
    const stored = await request.store.read();
    if (stored == null || stored.trim() === "") return { status: 200, body: snapshotToJson(emptySnapshot()) };
    try {
      return { status: 200, body: snapshotToJson(parseSnapshot(stored)) };
    } catch {
      return json(500, { error: "The stored session file could not be read." });
    }
  }
  if (request.method === "PUT") {
    let snapshot;
    try {
      snapshot = parseSnapshot(request.body ?? "");
    } catch (err) {
      const message = err instanceof Error ? err.message : "That document is not valid session JSON.";
      return json(400, { error: message });
    }
    const body = snapshotToJson(snapshot);
    await request.store.write(body);
    return { status: 200, body };
  }
  return json(405, { error: "Use GET or PUT." });
}
function json(status, body) {
  return { status, body: `${JSON.stringify(body)}
` };
}

// src/server/sessionsFunction.ts
var store = {
  async read() {
    const result = await get(CLOUD_BLOB_PATH, {
      access: "private",
      token: process.env.BLOB_READ_WRITE_TOKEN,
      useCache: false
    });
    if (result == null || result.statusCode !== 200 || result.stream == null) return null;
    return new Response(result.stream).text();
  },
  async write(body) {
    await put(CLOUD_BLOB_PATH, body, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 0,
      token: process.env.BLOB_READ_WRITE_TOKEN
    });
  }
};
async function handler(req, res) {
  const chunks = [];
  if (req.method === "PUT") {
    for await (const chunk of req) {
      chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
    }
  }
  const body = chunks.length > 0 ? new TextDecoder().decode(concatBytes(chunks)) : null;
  const result = await handleSessionsRequest({
    method: req.method,
    headers: req.headers,
    body,
    expectedPassphrase: process.env.HRV_PASSPHRASE,
    blobConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    store
  });
  res.statusCode = result.status;
  res.setHeader("content-type", result.status === 200 ? "application/json; charset=utf-8" : "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(result.body);
}
function concatBytes(parts) {
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}
export {
  handler as default
};
