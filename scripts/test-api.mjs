import assert from "node:assert/strict";
import { onRequest } from "../functions/api/[[path]].js";

class MockD1 {
  constructor() {
    this.users = new Map();
    this.logs = new Map();
  }

  prepare(sql) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    return new MockStatement(this, normalized);
  }
}

class MockStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    if (this.sql.startsWith("SELECT * FROM users WHERE code")) return this.db.users.get(this.values[0]) || null;
    if (this.sql.startsWith("SELECT * FROM group_logs WHERE id")) return this.db.logs.get(this.values[0]) || null;
    if (this.sql.startsWith("SELECT id FROM group_logs WHERE id")) {
      const row = this.db.logs.get(this.values[0]);
      return row ? { id: row.id } : null;
    }
    if (this.sql.startsWith("SELECT COUNT(*) AS count FROM group_logs")) {
      const [organizer, since] = this.values;
      const count = [...this.db.logs.values()].filter(row => row.organizer_user_code === organizer && row.created_at >= since).length;
      return { count };
    }
    throw new Error(`Unsupported first(): ${this.sql}`);
  }

  async run() {
    if (this.sql.startsWith("INSERT INTO users")) {
      const [code, authMethod, nickname, currentResult, diagnoses, friends, groups, createdAt, updatedAt] = this.values;
      const existing = this.db.users.get(code);
      this.db.users.set(code, {
        code,
        auth_method: authMethod,
        nickname,
        current_result_json: currentResult,
        diagnosis_history_json: diagnoses,
        friend_matches_json: friends,
        group_logs_json: groups,
        created_at: existing?.created_at || createdAt,
        updated_at: updatedAt
      });
      return { success: true };
    }
    if (this.sql.startsWith("UPDATE users SET friend_matches_json")) {
      const [friends, updatedAt, code] = this.values;
      const row = this.db.users.get(code);
      row.friend_matches_json = friends;
      row.updated_at = updatedAt;
      return { success: true };
    }
    if (this.sql.startsWith("INSERT INTO group_logs")) {
      const [id, name, targetCount, organizer, members, createdAt, updatedAt] = this.values;
      const existing = this.db.logs.get(id);
      this.db.logs.set(id, {
        id,
        name,
        target_count: targetCount,
        organizer_user_code: organizer,
        members_json: members,
        created_at: existing?.created_at || createdAt,
        updated_at: updatedAt
      });
      return { success: true };
    }
    if (this.sql.startsWith("UPDATE group_logs SET updated_at")) {
      const [updatedAt, id] = this.values;
      this.db.logs.get(id).updated_at = updatedAt;
      return { success: true };
    }
    if (this.sql.startsWith("DELETE FROM group_logs")) {
      this.db.logs.delete(this.values[0]);
      return { success: true };
    }
    throw new Error(`Unsupported run(): ${this.sql}`);
  }
}

const db = new MockD1();

async function call(method, path, body) {
  const request = new Request(`https://example.com${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const response = await onRequest({ request, env: { DB: db } });
  return { status: response.status, body: await response.json() };
}

const timestamp = Date.now();
const user = {
  code: "mogu-apiqa1",
  authMethod: "code",
  nickname: "QA",
  createdAt: timestamp,
  friendMatches: [
    { id: "expired", createdAt: timestamp - (91 * 24 * 60 * 60 * 1000) },
    { id: "active", createdAt: timestamp }
  ]
};
assert.equal((await call("PUT", "/api/user", { user })).status, 200);
const fetchedUser = await call("GET", `/api/user?code=${user.code}`);
assert.equal(fetchedUser.status, 200);
assert.deepEqual(fetchedUser.body.user.friendMatches.map(item => item.id), ["active"]);
assert.ok(fetchedUser.body.user.friendMatches[0].expiresAt > timestamp);

const statuses = [];
for (let index = 0; index < 6; index += 1) {
  const response = await call("POST", "/api/logs", {
    id: `table${index}`,
    name: `Table ${index}`,
    targetCount: 4,
    organizerUserCode: user.code,
    members: []
  });
  statuses.push(response.status);
}
assert.deepEqual(statuses, [201, 201, 201, 201, 201, 429]);

const activeRow = db.logs.get("table0");
activeRow.updated_at = timestamp - 1000;
const previousUpdatedAt = activeRow.updated_at;
const activeRead = await call("GET", "/api/logs/table0");
assert.equal(activeRead.status, 200);
assert.ok(db.logs.get("table0").updated_at > previousUpdatedAt);

db.logs.get("table1").updated_at = timestamp - (91 * 24 * 60 * 60 * 1000);
const expiredRead = await call("GET", "/api/logs/table1");
assert.equal(expiredRead.status, 404);
assert.equal(db.logs.has("table1"), false);

console.log("API retention and rate-limit tests passed");
