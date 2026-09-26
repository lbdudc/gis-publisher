import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import {
  applyCliOptions,
  deepMerge,
  deployProblems,
  parseSetting,
} from "../src/cli-options.js";

const defaults = {
  name: "test",
  version: "2.0.0",
  platform: { codePath: "a", featureModel: "b" },
  deploy: { type: "local" },
  host: "http://localhost:80",
};

test("a partial configuration is laid over the defaults, key by key", () => {
  const merged = deepMerge(defaults, {
    name: "demo",
    platform: { codePath: "z" },
    deploy: { type: "ssh" },
  });
  assert.equal(merged.name, "demo");
  assert.deepEqual(merged.platform, { codePath: "z", featureModel: "b" });
  assert.equal(merged.deploy.type, "ssh");
  assert.equal(merged.host, "http://localhost:80");
  // the defaults are not touched
  assert.equal(defaults.deploy.type, "local");
});

test("flags say what to deploy, without a configuration file", () => {
  const config = applyCliOptions(defaults, {
    name: "demo",
    appVersion: "3.1.0",
    type: "ssh",
    host: "203.0.113.5",
    port: 2222,
    user: "ubuntu",
    key: "keys/id.pem",
    remotePath: "/home/ubuntu/app",
    domain: "gis.example.org",
    acmeEmail: "me@example.org",
  });
  assert.equal(config.name, "demo");
  assert.equal(config.version, "3.1.0");
  assert.deepEqual(config.deploy, {
    type: "ssh",
    port: 2222,
    username: "ubuntu",
    remoteRepoPath: "/home/ubuntu/app",
    domain: "gis.example.org",
    acmeEmail: "me@example.org",
    host: "203.0.113.5",
    certRoute: path.resolve("keys/id.pem"),
    AWS_SSH_PRIVATE_KEY_PATH: path.resolve("keys/id.pem"),
  });
  assert.equal(config.host, "203.0.113.5");
  assert.equal(defaults.deploy.type, "local", "the input is not changed");
});

test("--host is the URL for a local deployment and the machine for the others", () => {
  assert.equal(
    applyCliOptions(defaults, { host: "http://localhost:8080" }).host,
    "http://localhost:8080"
  );
  assert.equal(
    applyCliOptions(defaults, { host: "http://localhost:8080" }).deploy.host,
    undefined
  );
  const ssh = applyCliOptions(defaults, { type: "ssh", host: "h.example.org" });
  assert.equal(ssh.deploy.host, "h.example.org");
});

test("a flag beats the configuration file, and false or empty flags change nothing", () => {
  const fromFile = deepMerge(defaults, {
    deploy: { type: "ssh", domain: "old.example.org", resetData: true },
  });
  const config = applyCliOptions(fromFile, {
    domain: "new.example.org",
    internalCertificate: false,
    resetData: false,
    user: "",
  });
  assert.equal(config.deploy.domain, "new.example.org");
  assert.equal(config.deploy.resetData, true);
  assert.equal(config.deploy.internalCertificate, undefined);
  assert.equal(config.deploy.username, undefined);
});

test("--set reaches any setting by its path, reading JSON values", () => {
  assert.deepEqual(parseSetting("deploy.domain=gis.example.org"), [
    "deploy.domain",
    "gis.example.org",
  ]);
  assert.deepEqual(parseSetting("deploy.port=22"), ["deploy.port", 22]);
  assert.deepEqual(parseSetting("a.b=true"), ["a.b", true]);
  assert.deepEqual(parseSetting('x={"k":1}'), ["x", { k: 1 }]);
  assert.deepEqual(parseSetting("note=a=b"), ["note", "a=b"]);
  assert.throws(() => parseSetting("nothing"), /key=value/);
  assert.throws(() => parseSetting("=x"), /key=value/);

  const config = applyCliOptions(defaults, {
    set: [
      "deploy.overwriteEditedLayers=true",
      "deploy.extra.deep=1",
      "name=viaSet",
    ],
  });
  assert.equal(config.deploy.overwriteEditedLayers, true);
  assert.equal(config.deploy.extra.deep, 1);
  assert.equal(config.name, "viaSet");
  assert.throws(
    () => applyCliOptions(defaults, { set: ["__proto__.polluted=1"] }),
    /not a valid/
  );
  assert.equal({}.polluted, undefined);
});

test("--zip makes the run end in a zip, and a zip file implies it", () => {
  assert.equal(applyCliOptions(defaults, { zip: true }).zip, true);
  assert.equal(applyCliOptions(defaults, { zip: true }).zipFile, undefined);
  const config = applyCliOptions(defaults, { zipFile: "out/demo.zip" });
  assert.equal(config.zip, true);
  assert.equal(config.zipFile, path.resolve("out/demo.zip"));
  assert.equal(applyCliOptions(defaults, { zip: false }).zip, undefined);
});

test("a zip is an option of generate, and has no domain of its own", () => {
  const zipped = applyCliOptions(defaults, { zip: true });
  assert.deepEqual(deployProblems(zipped, { deploying: false }), []);
  assert.match(
    deployProblems(zipped, { deploying: true }).join("|"),
    /option of --generate/
  );
  assert.match(
    deployProblems(
      { ...zipped, deploy: { type: "local", domain: "gis.example.org" } },
      { deploying: false }
    ).join("|"),
    /zipped app has no domain/
  );
});

const ssh = (extra = {}) => ({
  deploy: {
    type: "ssh",
    host: "1.2.3.4",
    username: "u",
    certRoute: "/k",
    remoteRepoPath: "/home/u/app",
    ...extra,
  },
});

test("a complete ssh deployment has no problems, with or without a domain", () => {
  assert.deepEqual(deployProblems(ssh()), []);
  assert.deepEqual(
    deployProblems(
      ssh({ domain: "gis.example.org", acmeEmail: "me@example.org" })
    ),
    []
  );
  assert.deepEqual(
    deployProblems(ssh({ domain: "gp.localhost", internalCertificate: true })),
    []
  );
  assert.deepEqual(deployProblems({ deploy: { type: "local" } }), []);
  assert.deepEqual(deployProblems({}), []);
});

test("what an ssh deployment lacks is said before anything is built", () => {
  const [problem] = deployProblems({ deploy: { type: "ssh" } });
  assert.match(problem, /needs: host, user, key, remote path/);
  assert.match(deployProblems(ssh({ username: "" }))[0], /needs: user/);
  // generating only never needs the server
  assert.deepEqual(
    deployProblems({ deploy: { type: "ssh" } }, { deploying: false }),
    []
  );
});

test("the remote folder follows the rules of the uploader", () => {
  for (const bad of [
    "/",
    "app",
    "/home",
    "/home/u/../..",
    "/a b/c",
    "/x/$(rm)",
    "~/app",
  ]) {
    assert.match(
      deployProblems(ssh({ remoteRepoPath: bad })).join("|"),
      /remote folder/,
      bad
    );
  }
  for (const good of ["/home/u/app", "/opt/gis-app_1.0"]) {
    assert.deepEqual(deployProblems(ssh({ remoteRepoPath: good })), [], good);
  }
});

test("domain and certificate settings are checked", () => {
  for (const bad of ["no_dots", "bad domain.org", "-x.example.org", "single"]) {
    assert.match(deployProblems(ssh({ domain: bad })).join("|"), /domain/, bad);
  }
  // a pasted address is tolerated: the scheme and path are dropped, as the generator does
  assert.deepEqual(
    deployProblems(ssh({ domain: "https://gis.example.org/x" })),
    []
  );
  assert.match(
    deployProblems(ssh({ domain: "gis.example.org", acmeEmail: "nope" })).join(
      "|"
    ),
    /email/
  );
  assert.match(
    deployProblems(ssh({ acmeEmail: "me@example.org" })).join("|"),
    /only used together with a domain/
  );
  assert.match(
    deployProblems(ssh({ internalCertificate: true })).join("|"),
    /only used together with a domain/
  );
});

test("an unknown deployment type is refused", () => {
  assert.match(
    deployProblems({ deploy: { type: "ftp" } })[0],
    /Unknown deployment type/
  );
});

test("an aws deployment lists what it lacks, and an existing machine needs none of it", () => {
  const [problem] = deployProblems({ deploy: { type: "aws" } });
  assert.match(problem, /AWS_REGION/);
  assert.match(problem, /AWS_SSH_PRIVATE_KEY_PATH/);
  assert.deepEqual(
    deployProblems({
      deploy: {
        type: "aws",
        host: "198.51.100.7",
        remoteRepoPath: "/home/ec2-user/code",
      },
    }),
    []
  );
});

test("the cloud provider flags go to the deploy settings", () => {
  const out = applyCliOptions(defaults, {
    type: "hetzner",
    serverName: "gis",
    serverSize: "cx32",
    serverRegion: "nbg1",
    serverImage: "ubuntu-22.04",
    key: "k",
  });
  assert.equal(out.deploy.type, "hetzner");
  assert.deepEqual(
    [
      out.deploy.serverName,
      out.deploy.serverSize,
      out.deploy.serverRegion,
      out.deploy.serverImage,
    ],
    ["gis", "cx32", "nbg1", "ubuntu-22.04"]
  );
});

test("a cloud deployment lists what it lacks, and an existing machine needs no name", () => {
  const saved = process.env.HCLOUD_TOKEN;
  delete process.env.HCLOUD_TOKEN;
  try {
    const [problem] = deployProblems({ deploy: { type: "hetzner" } });
    assert.match(problem, /a token, a server name, an ssh key/);
    assert.match(problem, /HCLOUD_TOKEN/);
    assert.deepEqual(
      deployProblems({
        deploy: {
          type: "digitalocean",
          cloudToken: "t",
          serverName: "n",
          certRoute: "/k",
        },
      }),
      []
    );
    assert.deepEqual(
      deployProblems({
        deploy: {
          type: "hetzner",
          cloudToken: "t",
          host: "203.0.113.1",
          certRoute: "/k",
        },
      }),
      []
    );
    assert.deepEqual(
      deployProblems({ deploy: { type: "hetzner" } }, { deploying: false }),
      []
    );
    process.env.HCLOUD_TOKEN = "from-env";
    assert.deepEqual(
      deployProblems({
        deploy: { type: "hetzner", serverName: "n", certRoute: "/k" },
      }),
      []
    );
  } finally {
    if (saved === undefined) delete process.env.HCLOUD_TOKEN;
    else process.env.HCLOUD_TOKEN = saved;
  }
});
