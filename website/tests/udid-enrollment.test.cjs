const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const { join } = require("node:path");
const { Readable } = require("node:stream");
const { createHash } = require("node:crypto");
const profileHandler = require("../api/udid-profile.js");
const callbackHandler = require("../api/udid-callback.js");

// Optional integration suite using an isolated PostgreSQL WASM instance.
// No production credentials, accounts, or network calls are used.
let PGlite;
try { ({ PGlite } = require(process.env.PEARSIGN_PGLITE_MODULE || "@electric-sql/pglite")); } catch {}

test("profile download and callback lifecycle against actual PostgreSQL", { skip: !PGlite && "Install @electric-sql/pglite or set PEARSIGN_PGLITE_MODULE" }, async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  const userId = "00000000-0000-4000-8000-000000000001";
  const udid = "00008030-0011223344556677";
  const anotherUdid = "00008030-8899AABBCCDDEEFF";
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql as 'select null::uuid';
    create role anon;
    create role authenticated;
    create role service_role;
    insert into auth.users values ('${userId}');
  `);
  // Upgrade the schema that was actually deployed before the format fix.
  const oldSetup = execFileSync("git", ["show", "da807bd:website/supabase/udid-storage.sql"], { cwd: join(__dirname, "../.."), encoding: "utf8" });
  await db.exec(oldSetup);
  await db.exec(readFileSync(join(__dirname, "../supabase/udid-format-fix.sql"), "utf8"));
  await db.exec(readFileSync(join(__dirname, "../supabase/udid-retry-fix.sql"), "utf8"));

  const oldEnv = { ...process.env };
  Object.assign(process.env, { SUPABASE_URL: "https://storage.example.invalid", SUPABASE_SECRET_KEY: "test-only", SUPABASE_PUBLISHABLE_KEY: "test-only-public", PEARSIGN_SITE_URL: "https://pear-sign.com" });
  t.after(() => {
    for (const name of ["SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_PUBLISHABLE_KEY", "PEARSIGN_SITE_URL"]) {
      if (oldEnv[name] === undefined) delete process.env[name]; else process.env[name] = oldEnv[name];
    }
  });

  const reply = (data, ok = true) => ({ ok, json: async () => data });
  t.mock.method(global, "fetch", async (url, init = {}) => {
    const endpoint = new URL(url);
    if (endpoint.pathname === "/auth/v1/user") return reply({ id: userId });
    if (endpoint.pathname.endsWith("/rpc/complete_pear_sign_udid_enrollment")) {
      const body = JSON.parse(init.body);
      const result = await db.query("select public.complete_pear_sign_udid_enrollment($1,$2) as saved", [body.p_token_hash, body.p_udid]);
      return reply(result.rows[0].saved);
    }
    if (endpoint.pathname.endsWith("/pear_sign_udid_enrollments")) {
      if (init.method === "DELETE") {
        await db.query("delete from public.pear_sign_udid_enrollments where expires_at < $1", [endpoint.searchParams.get("expires_at").slice(3)]);
        return reply(null);
      }
      if (init.method === "POST") {
        const body = JSON.parse(init.body);
        await db.query("insert into public.pear_sign_udid_enrollments (token_hash,user_id,expires_at) values ($1,$2,$3)", [body.token_hash, body.user_id, body.expires_at]);
        return reply(null);
      }
      const result = await db.query("select token_hash,completed_at from public.pear_sign_udid_enrollments where token_hash=$1 and expires_at > $2", [endpoint.searchParams.get("token_hash").slice(3), endpoint.searchParams.get("expires_at").slice(3)]);
      return reply(result.rows);
    }
    throw new Error(`Unexpected test endpoint: ${endpoint.pathname}`);
  });

  const response = () => ({
    headers: {}, status(code) { this.statusCode = code; return this; },
    setHeader(key, value) { this.headers[key] = value; },
    json(body) { this.body = body; }, send(body) { this.body = body; }, end(body) { this.body = body; },
  });
  async function start() {
    const res = response();
    await profileHandler({ method: "POST", headers: { authorization: "Bearer test-only-session" } }, res);
    assert.equal(res.statusCode, 200);
    return new URL(res.body.profileUrl).searchParams.get("token");
  }
  async function download(token) {
    const res = response();
    await profileHandler({ method: "GET", query: { token }, headers: {} }, res);
    return res;
  }
  async function callback(token, deviceUdid = udid, challengeOnly = false) {
    const xml = `<plist><dict><key>UDID</key><string>${deviceUdid}</string><key>CHALLENGE</key><string>${token}</string></dict></plist>`;
    const req = Readable.from([Buffer.from(xml)]);
    Object.assign(req, { method: "POST", url: challengeOnly ? "/api/udid-callback" : `/api/udid-callback?token=${token}`, headers: { host: "pear-sign.com" } });
    const res = response();
    await callbackHandler(req, res);
    return res;
  }
  const tokenA = await start();
  const tokenB = await start();
  await t.test("a second download leaves the first profile valid", async () => {
    assert.notEqual(tokenA, tokenB);
    for (const token of [tokenA, tokenB]) {
      const res = await download(token);
      assert.equal(res.statusCode, 200);
      assert.match(res.body, new RegExp(`<key>Challenge</key><string>${token}</string>`));
      assert.match(res.body, /<key>DeviceAttributes<\/key><array><string>UDID<\/string><\/array>/);
    }
  });
  await t.test("challenge-only response saves to the initiating account", async () => {
    const res = await callback(tokenA, udid, true);
    assert.equal(res.statusCode, 301);
    assert.equal(res.headers.Location, "https://pear-sign.com/account/?udid=saved");
    const result = await db.query("select udid from public.pear_sign_device_udids where user_id=$1", [userId]);
    assert.equal(result.rows[0].udid, udid);
  });
  await t.test("repeated device responses succeed without consuming the request again", async () => {
    const retries = await Promise.all([callback(tokenA), callback(tokenA)]);
    assert.deepEqual(retries.map((res) => res.statusCode), [301, 301]);
    assert.equal((await download(tokenA)).statusCode, 301);
  });
  await t.test("a completed token cannot register another device", async () => {
    assert.equal((await callback(tokenA, anotherUdid)).statusCode, 410);
  });
  await t.test("an old callback retry does not undo a later account change", async () => {
    await db.query("update public.pear_sign_device_udids set udid=$1 where user_id=$2", [anotherUdid, userId]);
    assert.equal((await callback(tokenA)).statusCode, 301);
    assert.equal((await db.query("select udid from public.pear_sign_device_udids where user_id=$1", [userId])).rows[0].udid, anotherUdid);
  });
  await t.test("expired requests fail and are pruned when another download starts", async () => {
    const hash = createHash("sha256").update(tokenB).digest("hex");
    await db.query("update public.pear_sign_udid_enrollments set expires_at=now()-interval '1 minute' where token_hash=$1", [hash]);
    assert.equal((await callback(tokenB)).statusCode, 410);
    await start();
    assert.equal((await db.query("select count(*)::int as count from public.pear_sign_udid_enrollments where token_hash=$1", [hash])).rows[0].count, 0);
  });
  await t.test("the full setup remains rerunnable without breaking completed requests", async () => {
    await db.exec(readFileSync(join(__dirname, "../supabase/udid-storage.sql"), "utf8"));
    assert.equal((await callback(tokenA)).statusCode, 301);
  });
  await t.test("anonymous clients cannot call the private completion function", async () => {
    await db.exec("set role anon");
    await assert.rejects(db.query("select public.complete_pear_sign_udid_enrollment($1,$2)", ["a".repeat(64), udid]), /permission denied/);
    await db.exec("reset role");
  });
});
