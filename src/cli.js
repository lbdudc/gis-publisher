import meow from 'meow';
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const usage = fs.readFileSync(
  path.join(__dirname, '../usage.txt'), 'utf8');

export default function cli() {
  const cli = meow(usage, {
    importMeta: import.meta
  })
  
  console.log(cli);
}