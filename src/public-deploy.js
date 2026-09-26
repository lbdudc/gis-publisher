import crypto from "crypto";
import fs from "fs";
import path from "path";

// Next to the generated product, like the editing password (edit-auth.js): the product is
// what gets uploaded to a server, and these are the passwords of its services.
const SECRETS_FILE = ".gp-deploy-secrets.json";
// Written after a good deploy (deploy-state.js): a deployment that has it already exists
const DEPLOY_STATE_FILE = ".gp-deploy-state.json";

// What every generated app used before deployments had their own passwords: the database of
// such an app already holds its password, and its GeoServer keeps the data folder shared by
// the apps of that machine (with its rasters), so both stay as they were.
const LEGACY_SECRETS = {
  geoserverPassword: "geoserver",
  databasePassword: "postgres",
  legacy: true,
};

const deployType = (deploy) => String(deploy?.type || "local").toLowerCase();

const bareHost = (value) =>
  String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "");

/** The domain the app is served at over HTTPS, or "" (a bare name: no scheme, no path). */
export function domainOf(deploy) {
  return bareHost(deploy?.domain);
}

/**
 * Deployments that are reachable by others: those to another machine (not `local`) and any
 * that has a domain (a local one with a domain is how HTTPS is tried out).
 */
export function isPublicDeploy(deploy) {
  const type = deployType(deploy);
  return type !== "local" || domainOf(deploy) !== "";
}

// Starts with a letter and has no uppercase letters or symbols: the templates put it in
// YAML, in a .env file and through a snake-case normalization, and all must read the same.
const newPassword = () => `gp${crypto.randomBytes(16).toString("hex")}`;

/**
 * The passwords of the services of the app deployed from `folder` (GeoServer admin and the
 * database): saved on the first run and kept across redeploys, because the database keeps
 * the password it was created with. An app deployed by an earlier version keeps the
 * defaults it was created with.
 * @param {string} folder where the generated product's `output` folder is
 * @returns {{geoserverPassword: string, databasePassword: string, legacy: boolean}}
 */
export function deploySecrets(
  folder,
  { file: fileName = SECRETS_FILE, allowLegacy = true } = {}
) {
  const file = path.join(folder, fileName);
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (saved.databasePassword) {
      const secrets = {
        geoserverPassword: saved.geoserverPassword,
        databasePassword: saved.databasePassword,
        legacy: saved.legacy === true,
      };
      if (secrets.geoserverPassword) return secrets;
      /* saved by a version that had no GeoServer password yet */
      secrets.geoserverPassword = secrets.legacy
        ? LEGACY_SECRETS.geoserverPassword
        : newPassword();
      return save(file, folder, secrets);
    }
  } catch {
    // none yet
  }

  const existing =
    allowLegacy &&
    fs.existsSync(path.join(folder, "output", DEPLOY_STATE_FILE));
  return save(
    file,
    folder,
    existing
      ? { ...LEGACY_SECRETS }
      : {
          geoserverPassword: newPassword(),
          databasePassword: newPassword(),
          legacy: false,
        }
  );
}

function save(file, folder, secrets) {
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(secrets, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  return secrets;
}

// A zip is always a new installation (never a redeploy over an old database): its own file,
// so that making one does not turn a deployment made from this folder "legacy"
const PACKAGE_SECRETS_FILE = ".gp-package-secrets.json";

/** The passwords of a zipped app: made once, kept for the next zip of the same app. */
export const packageSecrets = (folder) =>
  deploySecrets(folder, { file: PACKAGE_SECRETS_FILE, allowLegacy: false });

/**
 * What an app generated to be zipped needs in the parsed spec (mutates and returns `json`):
 * its own passwords, no published service ports, the portable compose (named volumes only, the
 * HTTPS front as an optional profile) and no address: it is not known until it is started.
 */
export function applyPackageToSpec(json, { secrets }) {
  const basicData = json.basicData || (json.basicData = {});
  basicData.extra = {
    ...basicData.extra,
    public_deploy: "true",
    portable: "true",
    geoserver_password: secrets.geoserverPassword,
    isolated_geoserver: "true",
  };
  basicData.database = {
    ...basicData.database,
    password: secrets.databasePassword,
  };
  return json;
}

/**
 * The address people will open the app at, when the configuration already says so: the
 * domain (served over HTTPS), or the host of an SSH target. null when it is only known
 * after the deployment (a machine that is created by it) or for a local deployment.
 * @param {object} deploy the `deploy` section of the configuration
 * @param {string} [topLevelHost] the configuration's own `host`
 */
export function publicUrlFor(deploy, topLevelHost) {
  const domain = domainOf(deploy);
  if (domain) return `https://${domain}`;
  if (!isPublicDeploy(deploy)) return null;
  const host = bareHost(deploy.host || topLevelHost);
  return host ? `http://${host}` : null;
}

/**
 * Applies what a deployment to another machine needs to the parsed spec (mutates and
 * returns `json`): a public address (the server's CORS origin), its own passwords, and the
 * flag that keeps the stack's services from publishing ports (see the compose template).
 */
export function applyPublicDeployToSpec(
  json,
  { publicUrl, secrets, domain, acmeEmail, internalCertificate }
) {
  const basicData = json.basicData || (json.basicData = {});
  const extra = { ...basicData.extra, public_deploy: "true" };
  if (publicUrl) extra.client_deploy_url = publicUrl;
  if (domain) {
    /* the HTTPS front (a Caddy service, see the compose template) */
    extra.domain = domain;
    if (acmeEmail) extra.acme_email = acmeEmail;
    /* the HTTPS front makes its own certificate instead of asking Let's Encrypt: for names
       only a private network knows, and for trying the whole thing out */
    if (internalCertificate) extra.tls_internal = "true";
  }
  if (secrets && !secrets.legacy) {
    extra.geoserver_password = secrets.geoserverPassword;
    /* GeoServer keeps its own data folder (a volume of the app) instead of the one shared
       by the apps of the machine, so its admin password is this app's own */
    extra.isolated_geoserver = "true";
    basicData.database = {
      ...basicData.database,
      password: secrets.databasePassword,
    };
  }
  basicData.extra = extra;
  return json;
}
