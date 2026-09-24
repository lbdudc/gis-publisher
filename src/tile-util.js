import fs from "fs";
import path from "path";

const SUFFIX = ".tiles.json";
const MAX_ZOOM = 24;

/**
 * Reads the XYZ tile layers the QGIS plugin stages as `<name>.tiles.json`
 * sidecars (there is no file to read for a tile service, and the file reader
 * doesn't know this kind of layer). Returns entries shaped like the reader's
 * own, with `type: "xyz"`; a sidecar that isn't usable is skipped with a
 * warning instead of failing the whole run.
 */
export function readTileSidecars(dir) {
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch (e) {
    return [];
  }

  const layers = [];
  for (const file of files
    .filter((f) => f.toLowerCase().endsWith(SUFFIX))
    .sort()) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
      const url = String(data.url || "").trim();

      if (!/^https?:\/\//i.test(url)) {
        throw new Error("the url must be http(s)");
      }
      if (!/\{z\}/.test(url) || !/\{-?y\}/.test(url) || !/\{x\}/.test(url)) {
        throw new Error("the url must contain {z}, {x} and {y}");
      }

      layers.push({
        name: file.slice(0, -SUFFIX.length),
        type: "xyz",
        hasSld: false,
        xyz: {
          url,
          attribution: data.attribution || "",
          zmin: zoomOrNull(data.zmin),
          zmax: zoomOrNull(data.zmax),
        },
      });
    } catch (e) {
      console.warn(`Skipping tile layer ${file}: ${e.message}`);
    }
  }
  return layers;
}

function zoomOrNull(value) {
  const zoom = Number(value);
  return Number.isInteger(zoom) && zoom >= 0 && zoom <= MAX_ZOOM ? zoom : null;
}
