const { createHash, randomBytes, randomUUID } = require("node:crypto");

const json = (response, status, body) => response.status(status).json(body);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const supabaseURL = () => (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const serviceKey = () => process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const siteURL = () => (process.env.PEARSIGN_SITE_URL || "https://pear-sign.com").replace(/\/$/, "");

async function supabaseRequest(path, options = {}) {
	const key = serviceKey();
	const response = await fetch(`${supabaseURL()}${path}`, {
		...options,
		headers: {
			apikey: key,
			Authorization: `Bearer ${key}`,
			...(options.body ? { "Content-Type": "application/json" } : {}),
			...options.headers,
		},
	});
	return response;
}

module.exports = async function udidProfile(request, response) {
	response.setHeader("Cache-Control", "no-store, private");
	response.setHeader("X-Content-Type-Options", "nosniff");

	if (!supabaseURL() || !process.env.SUPABASE_PUBLISHABLE_KEY || !serviceKey()) {
		return json(response, 503, { error: "UDID retrieval is not configured yet." });
	}

	if (request.method === "POST") {
		const authorization = request.headers.authorization || "";
		if (!authorization.startsWith("Bearer ")) return json(response, 401, { error: "Sign in to Pearsign first." });

		try {
			const userResponse = await fetch(`${supabaseURL()}/auth/v1/user`, {
				headers: {
					apikey: process.env.SUPABASE_PUBLISHABLE_KEY,
					Authorization: authorization,
				},
			});
			if (!userResponse.ok) return json(response, 401, { error: "Your Pearsign session has expired. Sign in again." });
			const user = await userResponse.json();
			if (!user.id) return json(response, 401, { error: "Sign in to Pearsign first." });

			const token = randomBytes(32).toString("hex");
			const insertResponse = await supabaseRequest("/rest/v1/pear_sign_udid_enrollments?on_conflict=user_id", {
				method: "POST",
				headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
				body: JSON.stringify({
					token_hash: sha256(token),
					user_id: user.id,
					expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
				}),
			});
			if (!insertResponse.ok) return json(response, 503, { error: "Could not start device identification. Check the Supabase setup and try again." });

			const profileURL = new URL("/api/udid-profile", siteURL());
			profileURL.searchParams.set("token", token);
			return json(response, 200, { profileUrl: profileURL.toString() });
		} catch {
			return json(response, 503, { error: "Pearsign could not reach account services. Please try again." });
		}
	}

	if (request.method !== "GET") {
		response.setHeader("Allow", "GET, POST");
		return json(response, 405, { error: "Method not allowed." });
	}

	const token = typeof request.query?.token === "string" ? request.query.token : "";
	if (!/^[a-f0-9]{64}$/.test(token)) return response.status(400).send("This UDID request link is invalid. Start again from your Pearsign account.");

	try {
		const enrollmentURL = new URL(`${supabaseURL()}/rest/v1/pear_sign_udid_enrollments`);
		enrollmentURL.searchParams.set("select", "token_hash");
		enrollmentURL.searchParams.set("token_hash", `eq.${sha256(token)}`);
		enrollmentURL.searchParams.set("expires_at", `gt.${new Date().toISOString()}`);
		const checkResponse = await supabaseRequest(`${enrollmentURL.pathname}${enrollmentURL.search}`);
		if (!checkResponse.ok) return response.status(503).send("Pearsign could not check this request. Please try again later.");
		const enrollments = await checkResponse.json();
		if (!enrollments.length) return response.status(410).send("This UDID request has expired or was already used. Start again from your Pearsign account.");

		const base = siteURL();
		const callback = new URL("/api/udid-callback", base);
		callback.searchParams.set("token", token);
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>PayloadContent</key><dict>
  <key>URL</key><string>${callback.toString()}</string>
  <key>DeviceAttributes</key><array><string>UDID</string></array>
</dict>
<key>PayloadOrganization</key><string>Pearsign</string>
<key>PayloadDisplayName</key><string>Pearsign UDID Request</string>
<key>PayloadDescription</key><string>Send this device UDID to your signed-in Pearsign account. No other device details are requested.</string>
<key>PayloadVersion</key><integer>1</integer>
<key>PayloadUUID</key><string>${randomUUID().toUpperCase()}</string>
<key>PayloadIdentifier</key><string>com.pear-sign.udid-request</string>
<key>PayloadType</key><string>Profile Service</string>
</dict></plist>`;

		response.setHeader("Content-Type", "application/x-apple-aspen-config");
		response.setHeader("Content-Disposition", 'attachment; filename="pearsign-udid.mobileconfig"');
		return response.status(200).send(xml);
	} catch {
		return response.status(503).send("Pearsign could not create the device request. Please try again later.");
	}
};
