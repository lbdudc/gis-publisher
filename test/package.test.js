import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

import { createReporter, PROTOCOL_PREFIX } from "../src/progress.js";
import { packageFiles } from "../src/package-util.js";
import { applyPackageToSpec, packageSecrets } from "../src/public-deploy.js";

test("the spec of an app made to be zipped: portable, no ports, its own passwords, and no address", () => {
  const json = {
    basicData: { name: "demo", extra: { geoserver_user: "admin" } },
  };
  applyPackageToSpec(json, {
    secrets: { geoserverPassword: "g1", databasePassword: "d1" },
  });
  assert.deepEqual(json.basicData.extra, {
    geoserver_user: "admin",
    public_deploy: "true",
    portable: "true",
    geoserver_password: "g1",
    isolated_geoserver: "true",
  });
  assert.equal(json.basicData.database.password, "d1");
  assert.equal(json.basicData.extra.client_deploy_url, undefined);
});

test("the passwords of a zipped app are made once, kept, and never 'legacy' even beside a deployed app", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "gp-pkg-"));
  fs.mkdirSync(path.join(folder, "output"));
  fs.writeFileSync(path.join(folder, "output", ".gp-deploy-state.json"), "{}");
  const first = packageSecrets(folder);
  assert.equal(first.legacy, false);
  assert.match(first.databasePassword, /^gp[0-9a-f]{32}$/);
  assert.match(first.geoserverPassword, /^gp[0-9a-f]{32}$/);
  assert.deepEqual(packageSecrets(folder), first);
  // its own file: the deployment's secrets are not touched
  assert.equal(
    fs.existsSync(path.join(folder, ".gp-deploy-secrets.json")),
    false
  );
  fs.rmSync(folder, { recursive: true, force: true });
});

test("the package files: scripts start the stack, HTTPS is opt-in, README is honest about the editing password", () => {
  const files = packageFiles({ name: "demo", editing: true });
  assert.deepEqual(Object.keys(files).sort(), [
    "README.md",
    "start.ps1",
    "start.sh",
  ]);

  assert.match(files["start.sh"], /^#!\/bin\/sh/);
  assert.match(files["start.sh"], /docker compose up -d --build/);
  assert.match(files["start.sh"], /--domain\)/);
  assert.match(files["start.sh"], /--internal-cert\)/);
  assert.match(files["start.sh"], /COMPOSE_PROFILES=https/);
  assert.match(files["start.sh"], /NGINX_BIND=127\.0\.0\.1:8081/);
  assert.match(files["start.ps1"], /\[string\]\$Domain/);
  assert.match(files["start.ps1"], /\[switch\]\$InternalCert/);
  assert.match(files["start.ps1"], /\$env:COMPOSE_PROFILES = "https"/);

  assert.match(files["README.md"], /^# demo/);
  assert.match(files["README.md"], /\.\/start\.sh --domain gis\.example\.org/);
  assert.match(files["README.md"], /## Editing/);
  assert.doesNotMatch(files["README.md"], /password "/i);

  const noEditing = packageFiles({ name: "demo" });
  assert.doesNotMatch(noEditing["README.md"], /## Editing/);
});

test("json progress: a zip result carries the file", () => {
  const lines = [];
  createReporter("json", (l) => lines.push(l)).result({
    file: "/tmp/demo-1.0.0.zip",
    outputDir: "/o",
  });
  const event = JSON.parse(lines[0].slice(PROTOCOL_PREFIX.length));
  assert.deepEqual(event, {
    event: "result",
    outputDir: "/o",
    file: "/tmp/demo-1.0.0.zip",
  });

  const text = [];
  createReporter("text", (l) => text.push(l)).result({
    file: "/tmp/a.zip",
    outputDir: "/o",
  });
  assert.deepEqual(text, ["Zip saved to /tmp/a.zip"]);
});
