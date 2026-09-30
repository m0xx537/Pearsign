const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const handler = require("../api/udid-callback.js");

// Isolated handler tests: no real credentials, device identifiers, or network.
const token = "a".repeat(64);
const xml = (udid) => Buffer.from(`<plist version="1.0"><dict><key>UDID</key><string>${udid}</string></dict></plist>`);
const der = (tag, content) => Buffer.concat([
  Buffer.from(content.length < 128 ? [tag, content.length] : [tag, 0x82, content.length >> 8, content.length & 255]), content,
]);
// CMS-shaped encapsulated content plus non-UTF8 signature bytes. The feature
// extracts the device identifier; it does not claim to verify Apple identity.
const cms = (udid) => der(0x30, Buffer.concat([
  Buffer.from("06092a864886f70d010702", "hex"),
  der(0xa0, der(0x30, der(0xa0, der(0x04, xml(udid))))),
  der(0x04, Buffer.from([0xff, 0x80, 0xfe, 0x01])),
]));

async function call(t, body, options = {}) {
  const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY, site: process.env.PEARSIGN_SITE_URL };
  process.env.SUPABASE_URL = "https://storage.example.invalid";
  process.env.SUPABASE_SECRET_KEY = "test-only-secret";
  process.env.PEARSIGN_SITE_URL = "https://pear-sign.com";
  t.after(() => {
    for (const [key, value] of Object.entries({ SUPABASE_URL: previous.url, SUPABASE_SECRET_KEY: previous.key, PEARSIGN_SITE_URL: previous.site })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const calls = [];
  t.mock.method(global, "fetch", async (url, init) => {
    calls.push({ url, ...init, body: JSON.parse(init.body) });
    return { ok: options.storageOK !== false, json: async () => options.saved !== false };
  });
  const request = Readable.from([body]);
  request.method = "POST";
  request.url = options.noUrlToken ? "/api/udid-callback" : `/api/udid-callback?token=${options.token ?? token}`;
  request.headers = { host: "pear-sign.com", "content-type": "application/pkcs7-signature" };
  const response = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(body) { this.body = body; } };
  await handler(request, response);
  return { response, calls };
}

for (const [name, udid] of [["modern", "00008030-001122aabbccddee"], ["legacy", "abcdef0123456789abcdef0123456789abcdef01"]]) {
  for (const [encoding, encode] of [["XML", xml], ["CMS", cms], ["base64 CMS", (value) => Buffer.from(cms(value).toString("base64"))]]) {
    test(`saves ${name} UDID from ${encoding} and redirects without exposing identifiers`, async (t) => {
      const { response, calls } = await call(t, encode(udid));
      assert.equal(response.statusCode, 301);
      assert.equal(response.headers.Location, "https://pear-sign.com/account/?udid=saved");
      assert.equal(calls.length, 1);
      assert.equal(calls[0].body.p_udid, udid.toUpperCase());
      assert.notEqual(calls[0].body.p_token_hash, token);
      assert.equal(calls[0].body.p_token_hash.length, 64);
    });
  }
}

for (const udid of ["00008030001122aabbccddee", "00008030-001122aabbccdde", "00008030-001122aabbccddeg", "a".repeat(39), ""]) {
  test(`rejects malformed identifier ${udid || "(empty)"} before accessing storage`, async (t) => {
    const { response, calls } = await call(t, xml(udid));
    assert.equal(response.statusCode, 400);
    assert.equal(calls.length, 0);
  });
}

test("expired enrollment never redirects as a success", async (t) => {
  const { response } = await call(t, cms("00008030-0011223344556677"), { saved: false });
  assert.equal(response.statusCode, 410);
  assert.equal(response.headers.Location, undefined);
});

test("storage failure never redirects as a success", async (t) => {
  const { response } = await call(t, cms("00008030-0011223344556677"), { storageOK: false });
  assert.equal(response.statusCode, 503);
  assert.equal(response.headers.Location, undefined);
});

test("invalid enrollment token never reaches storage", async (t) => {
  const { response, calls } = await call(t, cms("00008030-0011223344556677"), { token: "invalid" });
  assert.equal(response.statusCode, 400);
  assert.equal(calls.length, 0);
});

test("oversized callback is rejected before storage", async (t) => {
  const { response, calls } = await call(t, Buffer.alloc(128 * 1024 + 1));
  assert.equal(response.statusCode, 413);
  assert.equal(calls.length, 0);
});

test("Apple's CHALLENGE associates a callback even without a URL token", async (t) => {
  const body = Buffer.from(`<plist><dict><key>UDID</key><string>00008030-0011223344556677</string><key>CHALLENGE</key><string>${token}</string></dict></plist>`);
  const { response, calls } = await call(t, body, { noUrlToken: true });
  assert.equal(response.statusCode, 301);
  assert.equal(calls.length, 1);
});

test("a mismatched challenge cannot save a device to the URL token's account", async (t) => {
  const body = Buffer.from(`<plist><dict><key>UDID</key><string>00008030-0011223344556677</string><key>CHALLENGE</key><string>${"b".repeat(64)}</string></dict></plist>`);
  const { response, calls } = await call(t, body);
  assert.equal(response.statusCode, 400);
  assert.equal(calls.length, 0);
});
