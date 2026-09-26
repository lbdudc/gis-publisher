/**
 * Everything the command line can say about a run, applied to the configuration.
 *
 * The configuration file (`--config`) stays the place for a whole setup; these options make
 * the common cases a one-liner and let a flag override a value of the file. All of it is
 * plain data in, plain data out (`applyCliOptions`), so the same rules can be tested.
 */
import path from "path";

export const DEPLOY_TYPES = ["local", "ssh", "aws", "hetzner", "digitalocean"];

/** The cloud providers that rent a machine over a token (not AWS: it has its own keys). */
export const CLOUD_TYPES = ["hetzner", "digitalocean"];

/** Where each provider's token comes from when the configuration has none. */
export const CLOUD_TOKEN_VARIABLES = {
  hetzner: "HCLOUD_TOKEN",
  digitalocean: "DIGITALOCEAN_TOKEN",
};

const DOMAIN_RE =
  /^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9-]{2,63}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** `base` with `extra` laid over it: objects merge key by key, anything else is replaced. */
export function deepMerge(base, extra) {
  if (!isPlainObject(base) || !isPlainObject(extra)) {
    return extra === undefined ? base : extra;
  }
  const merged = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    merged[key] = key in base ? deepMerge(base[key], value) : value;
  }
  return merged;
}

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * `deploy.domain=gis.example.org` -> `["deploy.domain", "gis.example.org"]`. The value is read as
 * JSON when it is (`true`, `22`, `{"a":1}`), else it is the text as it is.
 */
export function parseSetting(text) {
  const at = String(text).indexOf("=");
  if (at <= 0) {
    throw new Error(
      `--set expects key=value (for example deploy.domain=gis.example.org), got "${text}"`
    );
  }
  const key = text.slice(0, at).trim();
  const raw = text.slice(at + 1);
  let value = raw;
  try {
    value = JSON.parse(raw);
  } catch {
    // plain text
  }
  return [key, value];
}

function setPath(target, dotted, value) {
  const parts = dotted.split(".");
  if (
    parts.some(
      (p) => !p || p === "__proto__" || p === "constructor" || p === "prototype"
    )
  ) {
    throw new Error(`--set: "${dotted}" is not a valid setting name`);
  }
  let node = target;
  for (const part of parts.slice(0, -1)) {
    if (!isPlainObject(node[part])) node[part] = {};
    node = node[part];
  }
  node[parts[parts.length - 1]] = value;
}

/** Flag name -> where it goes in `config.deploy` (the shortcuts of the common settings). */
const DEPLOY_FLAGS = {
  type: "type",
  port: "port",
  user: "username",
  remotePath: "remoteRepoPath",
  domain: "domain",
  acmeEmail: "acmeEmail",
  internalCertificate: "internalCertificate",
  resetData: "resetData",
  awsRegion: "AWS_REGION",
  awsAmi: "AWS_AMI_ID",
  awsInstanceType: "AWS_INSTANCE_TYPE",
  awsInstanceName: "AWS_INSTANCE_NAME",
  awsSecurityGroup: "AWS_SECURITY_GROUP_ID",
  awsKeyName: "AWS_KEY_NAME",
  awsUser: "AWS_USERNAME",
  serverName: "serverName",
  serverSize: "serverSize",
  serverRegion: "serverRegion",
  serverImage: "serverImage",
};

/**
 * @param {object} config the configuration (file or defaults); not changed
 * @param {object} flags what meow parsed (camelCase names)
 * @returns {object} the configuration with the flags applied
 */
export function applyCliOptions(config, flags = {}) {
  const out = structuredClone(config || {});
  out.deploy = isPlainObject(out.deploy) ? out.deploy : {};

  if (flags.name) out.name = flags.name;
  if (flags.appVersion) out.version = flags.appVersion;

  for (const [flag, key] of Object.entries(DEPLOY_FLAGS)) {
    const value = flags[flag];
    if (
      value === undefined ||
      value === null ||
      value === "" ||
      value === false
    )
      continue;
    out.deploy[key] = value;
  }
  // an ssh key given on the command line is relative to where the command runs
  if (flags.key) {
    const key = path.resolve(flags.key);
    out.deploy.certRoute = key;
    out.deploy.AWS_SSH_PRIVATE_KEY_PATH = key;
  }
  if (flags.awsRemotePath) out.deploy.REMOTE_REPO_PATH = flags.awsRemotePath;
  // Generating can end in a zip of the app (see main.js)
  if (flags.zip) out.zip = true;
  if (flags.zipFile) {
    out.zip = true;
    out.zipFile = path.resolve(flags.zipFile);
  }

  if (flags.host) {
    // ssh/aws: the machine (its address is also where the app answers when there is no domain);
    // local: the URL the app is opened at
    if (String(out.deploy.type || "local").toLowerCase() === "local") {
      out.host = flags.host;
    } else {
      out.deploy.host = flags.host;
      out.host = flags.host;
    }
  }

  for (const setting of [].concat(flags.set || [])) {
    const [key, value] = parseSetting(setting);
    setPath(out, key, value);
  }
  return out;
}

const bare = (value) =>
  String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "");

/**
 * What is wrong with the deploy settings, as sentences (empty when fine). Only what would make
 * the run fail anyway after minutes of building.
 * @param {object} config
 * @param {{deploying: boolean}} options `deploying` false for a generate-only run
 * @returns {string[]}
 */
export function deployProblems(config, { deploying = true } = {}) {
  const problems = [];
  const deploy = config?.deploy || {};
  const type = String(deploy.type || "local").toLowerCase();

  if (!DEPLOY_TYPES.includes(type)) {
    problems.push(
      `Unknown deployment type "${deploy.type}" (use ${DEPLOY_TYPES.join(
        ", "
      )}).`
    );
    return problems;
  }

  const domain = bare(deploy.domain);
  if (
    domain &&
    !DOMAIN_RE.test(domain) &&
    !/^[A-Za-z0-9-]+\.localhost$/.test(domain)
  ) {
    problems.push(
      `The domain "${deploy.domain}" must be a name like gis.example.org, without http:// or a path.`
    );
  }
  if (config?.zip && domain) {
    problems.push(
      "A zipped app has no domain of its own: give it to start.sh (--domain) when it is started."
    );
  }
  if (deploy.acmeEmail && !EMAIL_RE.test(String(deploy.acmeEmail))) {
    problems.push(
      `The certificate email "${deploy.acmeEmail}" does not look like an email address.`
    );
  }
  if (deploy.acmeEmail && !domain) {
    problems.push("An acme email is only used together with a domain.");
  }
  if (deploy.internalCertificate && !domain) {
    problems.push(
      "An internal certificate is only used together with a domain."
    );
  }

  if (config?.zip && deploying) {
    problems.push(
      "--zip is an option of --generate: it saves the app as a zip instead of deploying it."
    );
  }
  if (!deploying) return problems;

  if (type === "ssh") {
    const missing = [
      ["host", deploy.host || config.host],
      ["user", deploy.username],
      ["key", deploy.certRoute],
      ["remote path", deploy.remoteRepoPath],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length) {
      problems.push(
        `An ssh deployment needs: ${missing.join(
          ", "
        )} (--host, --user, --key, --remote-path).`
      );
    }
  }
  if (type === "aws" && !deploy.host) {
    const required = [
      "AWS_REGION",
      "AWS_AMI_ID",
      "AWS_INSTANCE_TYPE",
      "AWS_INSTANCE_NAME",
      "AWS_SECURITY_GROUP_ID",
      "AWS_KEY_NAME",
      "AWS_USERNAME",
      "AWS_SSH_PRIVATE_KEY_PATH",
      "REMOTE_REPO_PATH",
    ].filter(
      (key) =>
        !deploy[key] && !(key === "REMOTE_REPO_PATH" && deploy.remoteRepoPath)
    );
    if (required.length) {
      problems.push(
        `An aws deployment needs: ${required.join(
          ", "
        )} (--aws-region, --aws-ami, --aws-instance-type, ` +
          "--aws-instance-name, --aws-security-group, --aws-key-name, --aws-user, --key, --aws-remote-path; " +
          "or --host to use a machine that exists). The AWS keys come from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY or AWS_PROFILE."
      );
    }
  }
  if (CLOUD_TYPES.includes(type)) {
    const variable = CLOUD_TOKEN_VARIABLES[type];
    const missing = [
      ["a token", deploy.cloudToken || process.env[variable]],
      ["a server name", deploy.host || deploy.serverName],
      ["an ssh key", deploy.certRoute],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length) {
      problems.push(
        `A ${type} deployment needs ${missing.join(
          ", "
        )}: the API token comes from ${variable}, ` +
          "the machine from --server-name (or --host for one that exists) and its ssh key from --key " +
          "(the public key must be next to it, as <key>.pub). --server-size, --server-region and --server-image are optional."
      );
    }
  }
  const remote = deploy.remoteRepoPath || deploy.REMOTE_REPO_PATH;
  if (
    (type === "ssh" || type === "aws" || CLOUD_TYPES.includes(type)) &&
    remote
  ) {
    const folder = String(remote);
    const segments = folder.split("/").filter(Boolean);
    if (
      !/^\/[A-Za-z0-9._\-/]+$/.test(folder) ||
      segments.length < 2 ||
      segments.includes("..")
    ) {
      problems.push(
        `The remote folder "${folder}" must be an absolute path of letters, digits and . _ - / at least two levels deep ` +
          "(for example /home/ubuntu/app): it is emptied on every deploy."
      );
    }
  }
  return problems;
}
