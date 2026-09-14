const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const TOKEN_CHARS = "abcdefghijkmnpqrstuvwxyz23456789";
const RETENTION_TTL_SECONDS = 90 * 24 * 60 * 60;
const RETENTION_TTL_MS = RETENTION_TTL_SECONDS * 1000;
const GROUP_CREATE_WINDOW_MS = 60 * 1000;
const GROUP_CREATE_LIMIT = 5;

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: "D1 binding DB is not configured" }, 500);

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "");
  const parts = path.split("/").filter(Boolean);

  try {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
    if (request.method === "GET" && parts[0] === "health") return json({ ok: true });

    if (parts[0] === "user") {
      if (request.method === "GET") return getUser(env.DB, url.searchParams.get("code"));
      if (request.method === "PUT" || request.method === "POST") return upsertUser(env.DB, await readJson(request));
    }

    if (parts[0] === "logs") {
      if (request.method === "GET" && parts[1]) return getLog(env.DB, parts[1]);
      if (request.method === "POST" && !parts[1]) return createLog(env.DB, await readJson(request));
      if ((request.method === "PUT" || request.method === "POST") && parts[1] && !parts[2]) return upsertLog(env.DB, parts[1], await readJson(request));
      if (request.method === "POST" && parts[1] && parts[2] === "join") return joinLog(env.DB, parts[1], await readJson(request));
      if (request.method === "DELETE" && parts[1] && parts[2] === "members" && parts[3]) return leaveLog(env.DB, parts[1], parts[3]);
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    return json({ error: error.message || "Unexpected error" }, error.status || 500);
  }
}

function corsHeaders(request) {
  const origin = request.headers.get("origin") || "*";
  return {
    ...JSON_HEADERS,
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type"
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    const error = new Error("Invalid JSON body");
    error.status = 400;
    throw error;
  }
}

function now() {
  return Date.now();
}

function cleanCode(code) {
  return String(code || "").trim().slice(0, 40);
}

function cleanText(value, maxLength = 120) {
  return String(value || "").trim().slice(0, maxLength);
}

function stringifyJson(value, fallback) {
  return JSON.stringify(value ?? fallback);
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function retainedFriendMatches(value, timestamp = now()) {
  const records = Array.isArray(value) ? value : [];
  return records
    .filter(record => {
      const lastActiveAt = Number(record?.updatedAt || record?.createdAt || 0);
      const expiresAt = Number(record?.expiresAt || (lastActiveAt + RETENTION_TTL_MS));
      return expiresAt > timestamp;
    })
    .map(record => ({
      ...record,
      updatedAt: timestamp,
      expiresAt: timestamp + RETENTION_TTL_MS
    }));
}

function isExpired(timestamp, reference = now()) {
  return Number(timestamp || 0) < reference - RETENTION_TTL_MS;
}

async function activeLogRow(db, id, touch = false) {
  const row = await db.prepare("SELECT * FROM group_logs WHERE id = ?").bind(id).first();
  if (!row) return null;
  if (isExpired(row.updated_at)) {
    await db.prepare("DELETE FROM group_logs WHERE id = ?").bind(id).run();
    return null;
  }
  if (!touch) return row;
  const timestamp = now();
  await db.prepare("UPDATE group_logs SET updated_at = ? WHERE id = ?").bind(timestamp, id).run();
  row.updated_at = timestamp;
  return row;
}

function publicUser(row) {
  if (!row) return null;
  return {
    code: row.code,
    authMethod: row.auth_method || "code",
    nickname: row.nickname || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    currentResult: parseJson(row.current_result_json, null),
    diagnosisHistory: parseJson(row.diagnosis_history_json, []),
    friendMatches: parseJson(row.friend_matches_json, []),
    groupLogs: parseJson(row.group_logs_json, [])
  };
}

async function getUser(db, code) {
  const clean = cleanCode(code);
  if (!clean) return json({ error: "code is required" }, 400);
  const row = await db.prepare("SELECT * FROM users WHERE code = ?").bind(clean).first();
  if (!row) return json({ user: null }, 404);
  const timestamp = now();
  const friendMatches = retainedFriendMatches(parseJson(row.friend_matches_json, []), timestamp);
  row.friend_matches_json = stringifyJson(friendMatches, []);
  row.updated_at = timestamp;
  await db.prepare("UPDATE users SET friend_matches_json = ?, updated_at = ? WHERE code = ?")
    .bind(row.friend_matches_json, timestamp, clean)
    .run();
  return json({ user: publicUser(row) });
}

async function upsertUser(db, body) {
  const source = body.user || body;
  const code = cleanCode(source.code);
  if (!code) return json({ error: "user.code is required" }, 400);
  const timestamp = now();
  const createdAt = Number(source.createdAt || timestamp);
  const updatedAt = timestamp;
  const friendMatches = retainedFriendMatches(source.friendMatches, timestamp);

  await db.prepare(`
    INSERT INTO users (
      code, auth_method, nickname, current_result_json, diagnosis_history_json,
      friend_matches_json, group_logs_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      auth_method = excluded.auth_method,
      nickname = excluded.nickname,
      current_result_json = excluded.current_result_json,
      diagnosis_history_json = excluded.diagnosis_history_json,
      friend_matches_json = excluded.friend_matches_json,
      group_logs_json = excluded.group_logs_json,
      updated_at = excluded.updated_at
  `).bind(
    code,
    source.authMethod === "line" ? "line" : "code",
    cleanText(source.nickname || "", 60),
    source.currentResult ? stringifyJson(source.currentResult, null) : null,
    stringifyJson(source.diagnosisHistory, []),
    stringifyJson(friendMatches, []),
    stringifyJson(source.groupLogs, []),
    createdAt,
    updatedAt
  ).run();

  const row = await db.prepare("SELECT * FROM users WHERE code = ?").bind(code).first();
  return json({ user: publicUser(row) });
}

function publicLog(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    targetCount: row.target_count,
    organizerUserCode: row.organizer_user_code || "",
    members: parseJson(row.members_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function generateLogId(length = 7) {
  let id = "";
  for (let i = 0; i < length; i += 1) id += TOKEN_CHARS[Math.floor(Math.random() * TOKEN_CHARS.length)];
  return id;
}

function normalizeMember(member) {
  if (!member || !member.axisValues || !member.code) {
    const error = new Error("member with code and axisValues is required");
    error.status = 400;
    throw error;
  }
  return {
    userCode: cleanCode(member.userCode || `guest-${generateLogId(6)}`),
    nickname: cleanText(member.nickname || "", 60),
    code: cleanText(member.code, 4).toUpperCase(),
    typeName: cleanText(member.typeName || "", 80),
    axisValues: member.axisValues,
    version: member.version === "detail" || member.version === "detailed" ? "detail" : "simple",
    joinedAt: Number(member.joinedAt || now())
  };
}

async function getLog(db, id) {
  const clean = cleanCode(id);
  if (!clean) return json({ error: "合言葉を入れてください" }, 400);
  const row = await activeLogRow(db, clean, true);
  if (!row) return json({ error: "このテーブルは見つかりません。合言葉を確かめるか、新しいテーブルを立ててください" }, 404);
  return json({ log: publicLog(row) });
}

async function createLog(db, body) {
  const id = cleanCode(body.id || generateLogId());
  const organizerUserCode = cleanCode(body.organizerUserCode || body.hostUserId || "");
  if (organizerUserCode) {
    const rateRow = await db.prepare(`
      SELECT COUNT(*) AS count
      FROM group_logs
      WHERE organizer_user_code = ? AND created_at >= ?
    `).bind(organizerUserCode, now() - GROUP_CREATE_WINDOW_MS).first();
    if (Number(rateRow?.count || 0) >= GROUP_CREATE_LIMIT) {
      return json({ error: "続けてテーブルを立てすぎました。少し待ってから、もう一度試してください" }, 429);
    }
  }
  const log = {
    id,
    name: cleanText(body.name || body.logName || "テーブル :)", 80) || "テーブル :)",
    targetCount: Math.max(2, Math.min(12, Number(body.targetCount || body.capacity || 4))),
    organizerUserCode,
    members: Array.isArray(body.members) ? body.members.map(normalizeMember) : [],
    createdAt: Number(body.createdAt || now()),
    updatedAt: now()
  };
  await writeLog(db, log, false);
  const row = await db.prepare("SELECT * FROM group_logs WHERE id = ?").bind(id).first();
  return json({ log: publicLog(row) }, 201);
}

async function upsertLog(db, id, body) {
  const source = body.log || body;
  const clean = cleanCode(id || source.id);
  if (!clean) return json({ error: "合言葉を入れてください" }, 400);
  const existing = await activeLogRow(db, clean, false);
  if (!existing) return json({ error: "このテーブルは見つかりません。合言葉を確かめるか、新しいテーブルを立ててください" }, 404);
  const log = {
    id: clean,
    name: cleanText(source.name || "テーブル :)", 80) || "テーブル :)",
    targetCount: Math.max(2, Math.min(12, Number(source.targetCount || 4))),
    organizerUserCode: cleanCode(source.organizerUserCode || ""),
    members: Array.isArray(source.members) ? source.members.map(normalizeMember) : [],
    createdAt: Number(source.createdAt || now()),
    updatedAt: now()
  };
  await writeLog(db, log, true);
  const row = await db.prepare("SELECT * FROM group_logs WHERE id = ?").bind(log.id).first();
  return json({ log: publicLog(row) });
}

async function writeLog(db, log, allowUpdate) {
  const existing = await db.prepare("SELECT id FROM group_logs WHERE id = ?").bind(log.id).first();
  if (existing && !allowUpdate) {
    const error = new Error("log id already exists");
    error.status = 409;
    throw error;
  }
  await db.prepare(`
    INSERT INTO group_logs (id, name, target_count, organizer_user_code, members_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      target_count = excluded.target_count,
      organizer_user_code = excluded.organizer_user_code,
      members_json = excluded.members_json,
      updated_at = excluded.updated_at
  `).bind(
    log.id,
    log.name,
    log.targetCount,
    log.organizerUserCode,
    stringifyJson(log.members, []),
    log.createdAt,
    log.updatedAt
  ).run();
}

async function joinLog(db, id, body) {
  const clean = cleanCode(id);
  const row = await activeLogRow(db, clean, false);
  if (!row) return json({ error: "このテーブルは見つかりません。合言葉を確かめるか、新しいテーブルを立ててください" }, 404);
  const log = publicLog(row);
  const member = normalizeMember(body.member || body);
  const members = log.members || [];
  const existing = members.find(item => item.userCode === member.userCode);
  if (!existing && members.length >= log.targetCount) return json({ error: "このテーブルに空席はありません" }, 409);
  log.members = [member, ...members.filter(item => item.userCode !== member.userCode)];
  log.updatedAt = now();
  await writeLog(db, log, true);
  const updated = await db.prepare("SELECT * FROM group_logs WHERE id = ?").bind(clean).first();
  return json({ log: publicLog(updated) });
}

async function leaveLog(db, id, userCode) {
  const clean = cleanCode(id);
  const row = await activeLogRow(db, clean, false);
  if (!row) return json({ error: "このテーブルは見つかりません。合言葉を確かめるか、新しいテーブルを立ててください" }, 404);
  const log = publicLog(row);
  log.members = (log.members || []).filter(member => member.userCode !== userCode);
  log.updatedAt = now();
  await writeLog(db, log, true);
  return json({ log });
}
