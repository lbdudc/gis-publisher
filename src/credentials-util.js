// Credential keys a deployment can take from the environment when the config has none.
// The QGIS plugin passes AWS keys this way so they are never written to a file.
const ENV_CREDENTIAL_KEYS = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
];

/**
 * `config` with the AWS credential keys it lacks filled in from `env`. A key already in
 * the config is kept, and nothing is added for a deployment that is not AWS.
 */
export function withEnvCredentials(config, env = process.env) {
  if (String(config.type || "").toLowerCase() !== "aws") return config;
  const result = { ...config };
  for (const key of ENV_CREDENTIAL_KEYS) {
    if (!result[key] && env[key]) result[key] = env[key];
  }
  return result;
}
