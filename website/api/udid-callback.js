const { createHash } = require("node:crypto");

const MAX_BODY_BYTES = 128 * 1024;
const supabaseURL = () => (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const serviceKey = () => process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

async function readRequestBody(request) {
	const chunks = [];
	let total = 0;
	for await (const chunk of request) {
		total += chunk.length;
		if (total > MAX_BODY_BYTES) throw new Error("Request too large");
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString("utf8");
}

function page(response, status, heading, message, showLink = false) {
	response.statusCode = status;
	response.setHeader("Content-Type", "text/html; charset=utf-8");
	response.setHeader("Cache-Control", "no-store, private");
	response.setHeader("X-Content-Type-Options", "nosniff");
	response.setHeader("Referrer-Policy", "no-referrer");
	response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
	const link = showLink ? '<p><a href="https://pear-sign.com/account/?udid=saved">Return to your Pearsign account</a></p>' : "";
	return response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pearsign device check</title><body style="font:16px system-ui,sans-serif;max-width:34rem;margin:12vh auto;padding:1.25rem;color:#152033"><h1>${heading}</h1><p>${message}</p>${link}</body></html>`);
}

module.exports = async function udidCallback(request, response) {
	response.setHeader("Cache-Control", "no-store, private");
	if (!supabaseURL() || !serviceKey()) return page(response, 503, "Pearsign is unavailable", "Account storage is not configured. Please try again later.");
	if (request.method !== "POST") {
		response.setHeader("Allow", "POST");
		return page(response, 405, "Request not accepted", "This endpoint accepts a device response from iOS only.");
	}

	const requestURL = new URL(request.url || "/", `https://${request.headers.host || "pear-sign.com"}`);
	const token = requestURL.searchParams.get("token") || "";
	if (!/^[a-f0-9]{64}$/.test(token)) return page(response, 400, "Request expired", "Start a new UDID request from your Pearsign account.");

	let plist;
	try {
		plist = await readRequestBody(request);
	} catch {
		return page(response, 413, "Request too large", "The device response could not be processed.");
	}
	const udidMatch = plist.match(/<key>\s*UDID\s*<\/key>\s*<string>\s*([A-Fa-f0-9]{40})\s*<\/string>/i);
	if (!udidMatch) return page(response, 400, "UDID not found", "The device did not return a supported UDID. Start a new request and try again from Safari.");

	try {
		const completion = await fetch(`${supabaseURL()}/rest/v1/rpc/complete_pear_sign_udid_enrollment`, {
			method: "POST",
			headers: {
				apikey: serviceKey(),
				Authorization: `Bearer ${serviceKey()}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				p_token_hash: createHash("sha256").update(token).digest("hex"),
				p_udid: udidMatch[1].toUpperCase(),
			}),
		});
		if (!completion.ok) return page(response, 503, "Could not save this UDID", "Pearsign could not save the device response. Please start a new request from your account.");
		const saved = await completion.json();
		if (saved !== true) return page(response, 410, "Request expired", "This one-time UDID request has expired or was already used. Start a new one from your Pearsign account.");
		return page(response, 200, "UDID saved to Pearsign", "The UDID was saved to the Pearsign account that started this request. You can return to your account now.", true);
	} catch {
		return page(response, 503, "Could not save this UDID", "Pearsign could not reach account storage. Please start a new request from your account.");
	}
};

module.exports.config = { api: { bodyParser: false } };
