import crypto from "crypto";
import fs from "fs";
import path from "path";

// The editing account: changing data through the app API needs it (nginx checks it, see
// the nginx.conf of mini-lps). One password per app, made once and kept across redeploys.
export const EDIT_USER = "editor";
// Next to the generated product, not inside it: the product is what gets uploaded to a
// server, and the plain password must stay on this machine (the server gets only the hash)
const AUTH_FILE = ".gp-edit-auth.json";

/** An htpasswd line (`user:{SHA}base64`, the scheme nginx reads without extra modules). */
export function htpasswdLine(user, password) {
  const digest = crypto.createHash("sha1").update(password).digest("base64");
  return `${user}:{SHA}${digest}`;
}

/**
 * The editing account of the app deployed from `folder`: the saved password, or a new
 * random one (saved for the next run).
 * @returns {{user: string, password: string, htpasswd: string}}
 */
export function editAuth(folder) {
  const file = path.join(folder, AUTH_FILE);
  let password = null;
  try {
    password = JSON.parse(fs.readFileSync(file, "utf-8")).password;
  } catch {
    // none yet
  }
  if (typeof password !== "string" || password.length < 12) {
    password = crypto.randomBytes(12).toString("base64url");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ user: EDIT_USER, password }, null, 2),
      { encoding: "utf-8", mode: 0o600 }
    );
  }
  return {
    user: EDIT_USER,
    password,
    htpasswd: htpasswdLine(EDIT_USER, password),
  };
}
