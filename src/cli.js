#!/usr/bin/env node

import meow from "meow";
import fs from "fs";
import Gisbuilder2 from "./main.js";
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

const gisbuilder2 = new Gisbuilder2(config);
gisbuilder2.run(folder, bbox, !cli.flags.generate);

console.log(`Running gisbuilder2 for folder ${folder} and bbox ${bbox}`);
