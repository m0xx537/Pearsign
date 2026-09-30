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
	return Buffer.concat(chunks);
}

function extractDeviceResponse(text) {
	// Apple normally sends a PKCS#7 signed plist. Some delivery paths wrap that
	// payload in a form field or base64, so look through those common encodings too.
	const candidates = [text];
	const source = Buffer.from(text, "latin1");
	let visited = 0;
	const walkAsn1 = (start, limit, depth = 0) => {
		if (depth > 24 || visited > 4096) return start;
		let offset = start;
		while (offset < limit && visited <= 4096) {
			if (offset + 1 < limit && source[offset] === 0 && source[offset + 1] === 0) return offset + 2;
			visited += 1;
			const tag = source[offset++];
			if ((tag & 0x1f) === 0x1f) {
				while (offset < limit && (source[offset++] & 0x80) !== 0) {}
			}
			if (offset >= limit) break;
			const firstLength = source[offset++];
			let length;
			if (firstLength === 0x80) {
				if ((tag & 0x20) === 0) break;
				const contentStart = offset;
				offset = walkAsn1(offset, limit, depth + 1);
				if (offset <= contentStart || offset > limit) break;
				continue;
			}
			if ((firstLength & 0x80) === 0) {
				length = firstLength;
			} else {
				const lengthBytes = firstLength & 0x7f;
				if (lengthBytes === 0 || lengthBytes > 4 || offset + lengthBytes > limit) break;
				length = 0;
				for (let index = 0; index < lengthBytes; index += 1) length = length * 256 + source[offset++];
			}
			const contentEnd = offset + length;
			if (contentEnd > limit) break;
			if ((tag & 0x20) !== 0) {
				walkAsn1(offset, contentEnd, depth + 1);
			} else if ((tag & 0xc0) === 0 && (tag & 0x1f) === 0x04 && length > 0) {
				candidates.push(source.toString("latin1", offset, contentEnd));
			}
			offset = contentEnd;
		}
		return offset;
	};
	if (source.length > 2 && source[0] === 0x30) walkAsn1(0, source.length);
	const form = new URLSearchParams(text);
	for (const [key, value] of form) {
		if (/signeddata|plist|payload|data/i.test(key)) candidates.push(value);
	}

	for (let index = 0; index < candidates.length; index += 1) {
		const candidate = candidates[index];
		const match = candidate.match(/<key>\s*UDID\s*<\/key>\s*<string>\s*([A-Fa-f0-9]{40}|[A-Fa-f0-9]{8}-[A-Fa-f0-9]{16})\s*<\/string>/i);
		if (match) {
			// Newer devices use eight hex characters, a hyphen, then sixteen hex
			// characters. Preserve that hyphen: it is part of Apple's identifier.
			const challenge = candidate.match(/<key>\s*CHALLENGE\s*<\/key>\s*<string>\s*([^<]*)\s*<\/string>/i);
			return { udid: match[1].toUpperCase(), challenge: challenge?.[1].trim() || "" };
		}

		// A base64-encoded CMS or plist is ASCII in the outer request. Decode only
		// plausible payloads and inspect them as Latin-1 so embedded XML is retained.
		const encoded = candidate.replace(/\s/g, "");
		if (encoded.length >= 80 && encoded.length % 4 === 0 && /^[A-Za-z0-9+/=]+$/.test(encoded)) {
			try {
				const decoded = Buffer.from(encoded, "base64").toString("latin1");
				if (decoded !== candidate) candidates.push(decoded);
			} catch {
				// Ignore unrelated or malformed form fields.
			}
		}
	}
	return null;
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
	const urlToken = requestURL.searchParams.get("token") || "";

	let body;
	try {
		body = await readRequestBody(request);
	} catch {
		return page(response, 413, "Request too large", "The device response could not be processed.");
	}
	const device = extractDeviceResponse(body.toString("latin1"));
	if (!device) return page(response, 400, "UDID not found", "Apple’s device response could not be read. Start a new request from your Pearsign account and try again in Safari.");
	// Apple's Profile Service echoes Challenge in the signed device response.
	// Keep URL-token support for profiles downloaded before this change.
	const token = urlToken || device.challenge;
	if (!/^[a-f0-9]{64}$/.test(token) || (device.challenge && device.challenge !== token)) {
		return page(response, 400, "Invalid request", "Start a new UDID request from your Pearsign account.");
	}

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
				p_udid: device.udid,
			}),
		});
		if (!completion.ok) return page(response, 503, "Could not save this UDID", "Pearsign could not save the device response. Please start a new request from your account.");
		const saved = await completion.json();
		if (saved !== true) return page(response, 410, "Request no longer valid", "This request has expired or does not match the device that completed it. Start a new request from your Pearsign account.");
		// Finish the Profile Service exchange by returning to Safari with a GET.
		// A 200 HTML response here can be mistaken for another configuration profile.
		// Match the Profile Service -> Safari handoff used by udid.tech.
		response.statusCode = 301;
		response.setHeader("Location", new URL("/account/?udid=saved", process.env.PEARSIGN_SITE_URL || "https://pear-sign.com").toString());
		response.setHeader("Referrer-Policy", "no-referrer");
		return response.end();
	} catch {
		return page(response, 503, "Could not save this UDID", "Pearsign could not reach account storage. Please start a new request from your account.");
	}
};

module.exports.config = { api: { bodyParser: false } };
