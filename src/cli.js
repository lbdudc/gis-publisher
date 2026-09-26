#!/usr/bin/env node

import meow from "meow";
import fs from "fs";
import GISPublisher from "./main.js";
import { createReporter } from "./progress.js";
import {
  applyCliOptions,
  deepMerge,
  deployProblems,
  DEPLOY_TYPES,
} from "./cli-options.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const usage = fs.readFileSync(path.join(__dirname, "../usage.txt"), "utf8");

const cli = meow(usage, {
  importMeta: import.meta,
  flags: {
    debug: {
      type: "boolean",
      default: false,
    },
    generate: {
      type: "boolean",
      default: false,
      shortFlag: "g",
    },
    onlyImport: {
      type: "boolean",
      default: false,
      shortFlag: "i",
    },
    updateData: {
      type: "boolean",
      default: false,
    },
    config: {
      type: "string",
      isRequired: false,
    },
    bbox: {
      type: "string",
      isRequired: false,
    },
    progress: {
      type: "string",
      choices: ["text", "json"],
      default: "text",
    },
    // What to deploy and where, without a configuration file (see cli-options.js)
    name: { type: "string" },
    appVersion: { type: "string" },
    type: { type: "string", choices: DEPLOY_TYPES },
    host: { type: "string" },
    port: { type: "number" },
    user: { type: "string" },
    key: { type: "string" },
    remotePath: { type: "string" },
    domain: { type: "string" },
    acmeEmail: { type: "string" },
    internalCertificate: { type: "boolean", default: false },
    zip: { type: "boolean", default: false },
    zipFile: { type: "string" },
    resetData: { type: "boolean", default: false },
    awsRegion: { type: "string" },
    awsAmi: { type: "string" },
    awsInstanceType: { type: "string" },
    awsInstanceName: { type: "string" },
    awsSecurityGroup: { type: "string" },
    awsKeyName: { type: "string" },
    awsUser: { type: "string" },
    awsRemotePath: { type: "string" },
    serverName: { type: "string" },
    serverSize: { type: "string" },
    serverRegion: { type: "string" },
    serverImage: { type: "string" },
    set: { type: "string", isMultiple: true },
  },
});

// The defaults are always the base: a configuration file (or the flags below) only says what
// differs, so a short file works too.
const defaults = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../config.json"), "utf8")
);
let fileConfig = {};
if (cli.flags.config) {
  fileConfig = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), cli.flags.config), "utf8")
  );
}

let config;
try {
  config = applyCliOptions(deepMerge(defaults, fileConfig), cli.flags);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

const folder = cli.input.at(0);
if (!folder) {
  cli.showHelp();
}

const problems = deployProblems(config, {
  deploying: !cli.flags.generate || cli.flags.updateData,
});
if (problems.length > 0) {
  for (const problem of problems) console.error(`Error: ${problem}`);
  process.exit(2);
}

const bbox = cli.flags.bbox;

const reporter = createReporter(cli.flags.progress);
const gispublisher = new GISPublisher(config, { reporter });

console.log(`Running gispublisher for folder ${folder} and bbox ${bbox}`);

// Awaited (and wrapped) deliberately: run() is async, and leaving it a bare,
// un-awaited call meant a failed generation/deploy surfaced only as an
// unhandled promise rejection while the process could still exit 0 — the
// plugin's GISPublisherRunner decides success purely from the exit code, so
// that was a silent false "success" on every failure.
try {
  await gispublisher.run(
    folder,
    bbox,
    !cli.flags.generate,
    cli.flags.onlyImport,
    cli.flags.updateData
  );
} catch (error) {
  reporter.error(error);
  // json mode reports the failure as an event; keep the plain error on stderr too
  if (cli.flags.progress === "json") console.error(error);
  process.exitCode = 1;
}
