import { test } from "node:test";
import assert from "node:assert/strict";
import { withEnvCredentials } from "../src/credentials-util.js";

const env = {
  AWS_ACCESS_KEY_ID: "AKIAENV",
  AWS_SECRET_ACCESS_KEY: "secret-env", // pragma: allowlist secret
  AWS_SESSION_TOKEN: "token-env",
};

test("an AWS deployment takes the keys it lacks from the environment", () => {
  const result = withEnvCredentials(
    { type: "aws", AWS_REGION: "eu-west-1" },
    env
  );
  assert.equal(result.AWS_ACCESS_KEY_ID, "AKIAENV");
  assert.equal(result.AWS_SECRET_ACCESS_KEY, "secret-env");
  assert.equal(result.AWS_SESSION_TOKEN, "token-env");
  assert.equal(result.AWS_REGION, "eu-west-1");
});

test("keys in the config win over the environment", () => {
  const result = withEnvCredentials(
    { type: "AWS", AWS_ACCESS_KEY_ID: "AKIACFG" },
    env
  );
  assert.equal(result.AWS_ACCESS_KEY_ID, "AKIACFG");
  assert.equal(result.AWS_SECRET_ACCESS_KEY, "secret-env");
});

test("other deployments and empty environments are left alone", () => {
  const ssh = { type: "ssh", host: "h" };
  assert.equal(withEnvCredentials(ssh, env), ssh);
  assert.deepEqual(withEnvCredentials({ type: "aws" }, {}), { type: "aws" });
});
