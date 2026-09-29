module.exports = function config(_request, response) {
	response.setHeader("Cache-Control", "no-store");

	const projectUrl = process.env.SUPABASE_URL;
	const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
	if (!projectUrl || !publishableKey) {
		return response.status(503).json({ error: "Pearsign account sign-in is not configured yet." });
	}

	return response.status(200).json({ projectUrl, publishableKey });
};
