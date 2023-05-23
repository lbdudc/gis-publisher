import meow from "meow";
import fs from "fs";
import Gisbuilder2 from "./main.js";
import path from "path";

export default function cli(basepath) {
  const usage = fs.readFileSync(path.join(basepath, "usage.txt"), "utf8");
  const cli = meow(usage, {
    importMeta: import.meta,
  });

  const folder = cli.input.at(0);
  if (!folder) {
    cli.showHelp();
  }

  const bbox = cli.flags.bbox;

  const gisbuilder2 = new Gisbuilder2(path.join(basepath, folder), bbox);
  gisbuilder2.run();

  console.log(`Running gisbuilder2 for folder ${folder} and bbox ${bbox}`);
}
