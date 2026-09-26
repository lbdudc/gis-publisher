// Credential keys a deployment can take from the environment when the config has none.
// The QGIS plugin passes them this way so they are never written to a file.
const ENV_CREDENTIAL_KEYS = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
];

// The token of each provider that rents a machine over an API
const CLOUD_TOKEN_VARIABLES = {
  hetzner: "HCLOUD_TOKEN",
  digitalocean: "DIGITALOCEAN_TOKEN",
};

/**
 * `config` with the credentials it lacks filled in from `env`: the AWS keys for an aws
 * deployment, the API token (`cloudToken`) for hetzner or digitalocean. A value already in
 * the config is kept, and nothing is added for any other deployment.
 */
export function withEnvCredentials(config, env = process.env) {
  const type = String(config.type || "").toLowerCase();
  if (CLOUD_TOKEN_VARIABLES[type]) {
    const token = env[CLOUD_TOKEN_VARIABLES[type]];
    return !config.cloudToken && token
      ? { ...config, cloudToken: token }
      : config;
  }
  if (type !== "aws") return config;
  const result = { ...config };
  for (const key of ENV_CREDENTIAL_KEYS) {
    if (!result[key] && env[key]) result[key] = env[key];
  }
  return result;
}
