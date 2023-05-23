#!/usr/bin/env node
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import cli from "./src/cli.js";

cli(__dirname);
