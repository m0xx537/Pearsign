import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const authView = document.querySelector("#auth-view");
const accountView = document.querySelector("#account-view");
const form = document.querySelector("#auth-form");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const confirmInput = document.querySelector("#confirm-password");
const confirmField = document.querySelector("#confirm-field");
const notice = document.querySelector("#notice");
const submitButton = document.querySelector("#submit-button");
const loginTab = document.querySelector("#login-tab");
const signupTab = document.querySelector("#signup-tab");
const udidAutoButton = document.querySelector("#udid-auto-button");
const udidForm = document.querySelector("#udid-form");
const udidInput = document.querySelector("#udid-input");
const udidSaveButton = document.querySelector("#udid-save");
const udidRemoveButton = document.querySelector("#udid-remove");
const accountNotice = document.querySelector("#account-notice");

let mode = new URLSearchParams(window.location.search).get("flow") === "recovery" ? "recovery" : "login";
let supabase;
let signedInUser = null;
let udidLoadVersion = 0;

function showNotice(element, message, kind = "info") {
	if (!element) return;
	element.textContent = message;
	element.className = `notice show ${kind}`;
}

function clearNotice() {
	notice.textContent = "";
	notice.className = "notice";
}

function setMode(nextMode) {
	mode = nextMode;
	clearNotice();
	const recovery = mode === "recovery";
	const signup = mode === "signup";
	loginTab.classList.toggle("active", !signup && !recovery);
	signupTab.classList.toggle("active", signup);
	loginTab.setAttribute("aria-selected", String(!signup && !recovery));
	signupTab.setAttribute("aria-selected", String(signup));
	confirmField.hidden = !signup;
	confirmInput.required = signup;
	document.querySelector("#forgot-row").hidden = signup || recovery;
	document.querySelector("#form-heading").textContent = recovery ? "Choose a new password" : signup ? "Create your account" : "Welcome back";
	document.querySelector("#form-description").textContent = recovery ? "Enter a new password for your Pearsign account." : signup ? "We’ll email you a link to verify your address." : "Sign in to your Pearsign account.";
	passwordInput.autocomplete = signup || recovery ? "new-password" : "current-password";
	passwordInput.placeholder = recovery ? "Your new password" : "At least 8 characters";
	submitButton.textContent = recovery ? "Update password" : signup ? "Create account" : "Sign in";
}

loginTab.addEventListener("click", () => setMode("login"));
signupTab.addEventListener("click", () => setMode("signup"));
document.querySelector("#forgot-button").addEventListener("click", async () => {
	clearNotice();
	if (!supabase) return showNotice(notice, "Account sign-in is not configured yet.", "error");
	const email = emailInput.value.trim();
	if (!email) {
		emailInput.focus();
		return showNotice(notice, "Enter your email address first, then choose Forgot password?", "info");
	}
	const { error } = await supabase.auth.resetPasswordForEmail(email, {
		redirectTo: `${window.location.origin}/account/?flow=recovery`,
	});
	if (error) return showNotice(notice, error.message, "error");
	showNotice(notice, "If an account exists for that address, a password reset link is on its way.", "success");
});

form.addEventListener("submit", async (event) => {
	event.preventDefault();
	clearNotice();
	if (!supabase) return showNotice(notice, "Account sign-in is not configured yet. Please try again later.", "error");
	const email = emailInput.value.trim();
	const password = passwordInput.value;
	submitButton.disabled = true;
	try {
		if (mode === "signup") {
			if (password !== confirmInput.value) return showNotice(notice, "Those passwords don’t match.", "error");
			const { data, error } = await supabase.auth.signUp({
				email,
				password,
				options: { emailRedirectTo: `${window.location.origin}/account/` },
			});
			if (error) return showNotice(notice, error.message, "error");
			if (data.session) showNotice(notice, "Your Pearsign account is ready.", "success");
			else showNotice(notice, "Check your inbox for a verification link to finish creating your account.", "success");
		} else if (mode === "recovery") {
			const { error } = await supabase.auth.updateUser({ password });
			if (error) return showNotice(notice, error.message, "error");
			window.history.replaceState({}, "", "/account/");
			setMode("login");
			showNotice(notice, "Your password has been updated. You can now sign in.", "success");
		} else {
			const { error } = await supabase.auth.signInWithPassword({ email, password });
			if (error) return showNotice(notice, error.message, "error");
		}
	} catch {
		showNotice(notice, "We couldn’t reach Pearsign account services. Please try again.", "error");
	} finally {
		submitButton.disabled = false;
	}
});

document.querySelector("#signout-button").addEventListener("click", async () => {
	if (!supabase) return;
	const { error } = await supabase.auth.signOut();
	if (error) showNotice(accountNotice, error.message, "error");
});

udidAutoButton.addEventListener("click", async () => {
	if (!supabase || !signedInUser) return showNotice(accountNotice, "Sign in to start a UDID request for your Pearsign account.", "error");
	const userAgent = navigator.userAgent;
	const isIOS = /iPhone|iPad|iPod/.test(userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
	const isSafari = /Safari/.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent);
	if (!isIOS || !isSafari) return showNotice(accountNotice, "Open pear-sign.com/account in Safari on the iPhone or iPad you want to add, sign in, then try again.", "info");
	if (window.location.protocol !== "https:") return showNotice(accountNotice, "Automatic UDID retrieval needs the published HTTPS website. You can use manual entry while viewing this local copy.", "info");

	udidAutoButton.disabled = true;
	udidAutoButton.textContent = "Preparing request…";
	try {
		const { data: { session }, error: sessionError } = await supabase.auth.getSession();
		if (sessionError || !session?.access_token) return showNotice(accountNotice, "Your Pearsign session expired. Sign in again and retry.", "error");
		const result = await fetch("/api/udid-profile", {
			method: "POST",
			headers: { Authorization: `Bearer ${session.access_token}`, Accept: "application/json" },
		});
		const payload = await result.json().catch(() => ({}));
		if (!result.ok || !payload.profileUrl) return showNotice(accountNotice, payload.error || "Could not start the UDID request. Please try again.", "error");
		const profileURL = new URL(payload.profileUrl, window.location.origin);
		if (profileURL.origin !== window.location.origin) return showNotice(accountNotice, "Pearsign returned an invalid profile link. Please contact support.", "error");
		window.location.assign(profileURL.toString());
	} catch {
		showNotice(accountNotice, "We couldn’t reach Pearsign account services. Please try again.", "error");
	} finally {
		udidAutoButton.disabled = false;
		udidAutoButton.textContent = "Get UDID from this device";
	}
});

udidForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	if (!supabase || !signedInUser) return showNotice(accountNotice, "Sign in to save a UDID to your Pearsign account.", "error");
	const udid = udidInput.value.trim().toUpperCase();
	if (!/^[A-F0-9]{40}$/.test(udid)) {
		udidInput.setCustomValidity("Enter a 40-character hexadecimal UDID.");
		udidInput.reportValidity();
		udidInput.setCustomValidity("");
		return;
	}
	udidInput.value = udid;
	udidSaveButton.disabled = true;
	udidRemoveButton.disabled = true;
	try {
		const { error } = await supabase.from("pear_sign_device_udids").upsert(
			{ user_id: signedInUser.id, udid },
			{ onConflict: "user_id" },
		);
		if (error) {
			const missingTable = error.code === "42P01" || error.code === "PGRST205";
			return showNotice(accountNotice, missingTable
				? "UDID storage isn’t set up yet. Run the setup SQL in website/supabase/udid-storage.sql in your Supabase project."
				: "We couldn’t save this UDID. Check that the Supabase UDID table and account security rules are set up, then try again.", "error");
		}
		udidRemoveButton.hidden = false;
		document.querySelector("#udid-manual-summary").textContent = "UDID saved to this account · Edit or remove";
		showNotice(accountNotice, "UDID format checked and saved to your Pearsign account.", "success");
	} catch {
		showNotice(accountNotice, "We couldn’t reach Pearsign account services. Please try again.", "error");
	} finally {
		udidSaveButton.disabled = false;
		udidRemoveButton.disabled = false;
	}
});

udidRemoveButton.addEventListener("click", async () => {
	if (!supabase || !signedInUser) return;
	udidRemoveButton.disabled = true;
	udidSaveButton.disabled = true;
	try {
		const { error } = await supabase.from("pear_sign_device_udids").delete().eq("user_id", signedInUser.id);
		if (error) return showNotice(accountNotice, "We couldn’t remove the saved UDID. Please try again.", "error");
		udidInput.value = "";
		udidRemoveButton.hidden = true;
		document.querySelector("#udid-manual-summary").textContent = "Enter a UDID manually";
		showNotice(accountNotice, "Saved UDID removed from your Pearsign account.", "success");
	} catch {
		showNotice(accountNotice, "We couldn’t reach Pearsign account services. Please try again.", "error");
	} finally {
		udidRemoveButton.disabled = false;
		udidSaveButton.disabled = false;
	}
});

async function loadSavedUDID(user) {
	const version = ++udidLoadVersion;
	udidInput.value = "";
	udidRemoveButton.hidden = true;
	if (!supabase || !user) return;
	let data;
	let error;
	try {
		({ data, error } = await supabase.from("pear_sign_device_udids").select("udid").eq("user_id", user.id).maybeSingle());
	} catch {
		if (version === udidLoadVersion && signedInUser?.id === user.id) {
			showNotice(accountNotice, "We couldn’t reach Pearsign account services. Please try again.", "error");
		}
		return;
	}
	if (version !== udidLoadVersion || signedInUser?.id !== user.id) return;
	if (error) {
		const missingTable = error.code === "42P01" || error.code === "PGRST205";
		showNotice(accountNotice, missingTable
			? "UDID storage isn’t set up yet. Run the setup SQL in website/supabase/udid-storage.sql in your Supabase project."
			: "We couldn’t load the saved UDID. Check that the Supabase account security rules are set up.", "error");
		return;
	}
	if (data?.udid) {
		udidInput.value = data.udid;
		udidRemoveButton.hidden = false;
		document.querySelector("#udid-manual-summary").textContent = "UDID saved to this account · Edit or remove";
		if (new URLSearchParams(window.location.search).get("udid") === "saved") {
			showNotice(accountNotice, "Your device UDID has been saved to this Pearsign account.", "success");
		}
	} else {
		document.querySelector("#udid-manual-summary").textContent = "Enter a UDID manually";
	}
}

function renderSession(session) {
	const user = session?.user ?? null;
	const isSignedIn = Boolean(user);
	authView.classList.toggle("hide", isSignedIn);
	accountView.classList.toggle("show", isSignedIn);
	signedInUser = user;
	if (isSignedIn) document.querySelector("#signed-in-email").textContent = user.email ?? "Pearsign account";
	else {
		udidLoadVersion += 1;
		udidInput.value = "";
		udidRemoveButton.hidden = true;
		document.querySelector("#udid-manual-summary").textContent = "Enter a UDID manually";
	}
	void loadSavedUDID(user);
}

setMode(mode);

try {
	const configResponse = await fetch("/api/config", { headers: { Accept: "application/json" } });
	if (!configResponse.ok) throw new Error("not configured");
	const { projectUrl, publishableKey } = await configResponse.json();
	if (!projectUrl || !publishableKey) throw new Error("not configured");
	supabase = createClient(projectUrl, publishableKey, {
		auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
	});
	supabase.auth.onAuthStateChange((_event, session) => renderSession(session));
	const { data: { session } } = await supabase.auth.getSession();
	renderSession(session);
} catch {
	showNotice(notice, "Account sign-in is not connected yet. Add the Supabase project URL and publishable key to Pearsign’s Vercel project settings, then redeploy.", "info");
}
