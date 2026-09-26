import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  applyPublicDeployToSpec,
  deploySecrets,
  domainOf,
  isPublicDeploy,
  publicUrlFor,
} from "../src/public-deploy.js";

const tempFolder = () => fs.mkdtempSync(path.join(os.tmpdir(), "gp-public-"));

test("only deployments to another machine are public", () => {
  assert.equal(isPublicDeploy({ type: "ssh" }), true);
  assert.equal(isPublicDeploy({ type: "AWS" }), true);
  assert.equal(isPublicDeploy({ type: "local" }), false);
  assert.equal(isPublicDeploy({}), false);
  assert.equal(isPublicDeploy(undefined), false);
});

test("a domain makes even a local deployment public", () => {
  assert.equal(isPublicDeploy({ type: "local", domain: "gp.localhost" }), true);
  assert.equal(
    domainOf({ type: "ssh", domain: " HTTPS://gis.example.org/x " }),
    "gis.example.org"
  );
  assert.equal(domainOf({ type: "ssh" }), "");
});

test("the public address comes from the domain, else from the host", () => {
  assert.equal(
    publicUrlFor({ type: "ssh", host: "10.0.0.5", domain: "gis.example.org" }),
    "https://gis.example.org"
  );
  assert.equal(
    publicUrlFor({ type: "ssh", domain: " https://gis.example.org/ " }),
    "https://gis.example.org"
  );
  assert.equal(
    publicUrlFor({ type: "ssh", host: "10.0.0.5" }),
    "http://10.0.0.5"
  );
  assert.equal(
    publicUrlFor({ type: "ssh" }, "server.lan"),
    "http://server.lan"
  );
  // a machine the deployment creates has no address yet
  assert.equal(publicUrlFor({ type: "aws" }), null);
  assert.equal(
    publicUrlFor({ type: "local", host: "http://localhost:80" }),
    null
  );
  assert.equal(
    publicUrlFor({ type: "local", domain: "gp.localhost" }),
    "https://gp.localhost"
  );
});

test("a new deployment gets its own passwords, kept across runs", () => {
  const folder = tempFolder();
  const first = deploySecrets(folder);
  assert.match(first.geoserverPassword, /^gp[0-9a-f]{32}$/);
  assert.match(first.databasePassword, /^gp[0-9a-f]{32}$/);
  assert.notEqual(first.geoserverPassword, first.databasePassword);
  assert.equal(first.legacy, false);
  assert.deepEqual(deploySecrets(folder), first);
  fs.rmSync(folder, { recursive: true, force: true });
});

test("a deployment made by an earlier version keeps its default passwords", () => {
  const folder = tempFolder();
  fs.mkdirSync(path.join(folder, "output"));
  fs.writeFileSync(path.join(folder, "output", ".gp-deploy-state.json"), "{}");
  assert.deepEqual(deploySecrets(folder), {
    geoserverPassword: "geoserver",
    databasePassword: "postgres",
    legacy: true,
  });
  // and it stays that way once the deployment has been recorded
  assert.equal(deploySecrets(folder).legacy, true);
  fs.rmSync(folder, { recursive: true, force: true });
});

test("a damaged secrets file is made again", () => {
  const folder = tempFolder();
  fs.writeFileSync(path.join(folder, ".gp-deploy-secrets.json"), "not json");
  assert.match(deploySecrets(folder).databasePassword, /^gp[0-9a-f]{32}$/);
  fs.rmSync(folder, { recursive: true, force: true });
});

test("the spec gets the public address, the passwords and the flag", () => {
  const json = {
    basicData: { name: "demo", extra: { geoserver_user: "admin" } },
  };
  applyPublicDeployToSpec(json, {
    publicUrl: "https://gis.example.org",
    secrets: { geoserverPassword: "g1", databasePassword: "d1" },
  });
  assert.deepEqual(json.basicData.extra, {
    geoserver_user: "admin",
    public_deploy: "true",
    client_deploy_url: "https://gis.example.org",
    geoserver_password: "g1",
    isolated_geoserver: "true",
  });
  assert.equal(json.basicData.database.password, "d1");
});

test("a deployment of an earlier version keeps its passwords and its shared GeoServer", () => {
  const json = { basicData: { name: "demo" } };
  applyPublicDeployToSpec(json, {
    publicUrl: "http://10.0.0.5",
    secrets: {
      geoserverPassword: "geoserver",
      databasePassword: "postgres",
      legacy: true,
    },
  });
  assert.equal(json.basicData.extra.public_deploy, "true");
  assert.equal(json.basicData.database, undefined);
});

test("without a known address no client_deploy_url is set", () => {
  const json = { basicData: { name: "demo" } };
  applyPublicDeployToSpec(json, {
    publicUrl: null,
    secrets: { geoserverPassword: "g1", databasePassword: "d1" },
  });
  assert.equal(json.basicData.extra.client_deploy_url, undefined);
  assert.equal(json.basicData.extra.public_deploy, "true");
});

test("a domain and a certificate email reach the spec", () => {
  const json = { basicData: { name: "demo" } };
  applyPublicDeployToSpec(json, {
    publicUrl: "https://gis.example.org",
    domain: "gis.example.org",
    acmeEmail: "me@example.org",
  });
  assert.equal(json.basicData.extra.domain, "gis.example.org");
  assert.equal(json.basicData.extra.acme_email, "me@example.org");
  assert.equal(json.basicData.database, undefined);

  const plain = { basicData: {} };
  applyPublicDeployToSpec(plain, { publicUrl: null });
  assert.equal(plain.basicData.extra.domain, undefined);
});

test("a secrets file from before GeoServer had a password gets one", () => {
  const folder = tempFolder();
  fs.writeFileSync(
    path.join(folder, ".gp-deploy-secrets.json"),
    JSON.stringify({ databasePassword: "gpold", legacy: false })
  );
  const secrets = deploySecrets(folder);
  assert.equal(secrets.databasePassword, "gpold");
  assert.match(secrets.geoserverPassword, /^gp[0-9a-f]{32}$/);
  assert.deepEqual(deploySecrets(folder), secrets);

  fs.writeFileSync(
    path.join(folder, ".gp-deploy-secrets.json"),
    JSON.stringify({ databasePassword: "postgres", legacy: true })
  );
  assert.equal(deploySecrets(folder).geoserverPassword, "geoserver");
  fs.rmSync(folder, { recursive: true, force: true });
});

test("an internal certificate is asked for only together with a domain", () => {
  const json = { basicData: {} };
  applyPublicDeployToSpec(json, {
    publicUrl: "https://gp.internal",
    domain: "gp.internal",
    internalCertificate: true,
  });
  assert.equal(json.basicData.extra.tls_internal, "true");

  const noDomain = { basicData: {} };
  applyPublicDeployToSpec(noDomain, {
    publicUrl: null,
    internalCertificate: true,
  });
  assert.equal(noDomain.basicData.extra.tls_internal, undefined);
});
