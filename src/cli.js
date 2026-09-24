#!/usr/bin/env node

import meow from "meow";
import fs from "fs";
import GISPublisher from "./main.js";
import { createReporter } from "./progress.js";
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
  },
});

let configFile;
if (cli.flags.config) {
  configFile = fs.readFileSync(
    path.join(process.cwd(), cli.flags.config),
    "utf8"
  );
} else {
  configFile = fs.readFileSync(path.join(__dirname, "../config.json"), "utf8");
}

const config = JSON.parse(configFile);

const folder = cli.input.at(0);
if (!folder) {
  cli.showHelp();
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
    cli.flags.onlyImport
  );
} catch (error) {
  reporter.error(error);
  // json mode reports the failure as an event; keep the plain error on stderr too
  if (cli.flags.progress === "json") console.error(error);
  process.exitCode = 1;
}
