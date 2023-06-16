#!/usr/bin/env node

import meow from "meow";
import fs from "fs";
import GISPublisher from "./main.js";
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

const gispublisher = new GISPublisher(config);
gispublisher.run(folder, bbox, !cli.flags.generate, cli.flags.onlyImport);

console.log(`Running gispublisher for folder ${folder} and bbox ${bbox}`);
