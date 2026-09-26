import fs from "fs";
import path from "path";
import { lowerCamelCase } from "./str-util.js";

const SUFFIX = ".live.json";

/**
 * What a "live" layer is: a PostGIS table or a WFS layer that is not copied into the app.
 * The app's own GeoServer connects to it (a store of its own) and draws it as a WMS layer
 * with the layer's QGIS style; it has no table in the app's database, so no list, search,
 * editing or download either.
 *
 * The QGIS plugin stages one `<name>.live.json` sidecar per live layer (next to the `.sld`
 * of its style, when it has one):
 *
 *   {"kind": "postgis", "host": "db.example.org", "port": 5432, "database": "gis",
 *    "schema": "public", "table": "towns", "user": "reader", "password": "...", "srid": 4326}
 *   {"kind": "wfs", "url": "https://example.org/geoserver/wfs", "typeName": "ns:towns",
 *    "user": "...", "password": "...", "srid": 4326}
 */

/** The name of the host machine as a container sees it (compose maps it, see docker-compose.yml). */
export const HOST_FROM_CONTAINER = "host.docker.internal";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/** A source on this very machine is reached from inside the containers through the host. */
export const reachableHost = (host) =>
  LOOPBACK.has(
    String(host || "")
      .trim()
      .toLowerCase()
  )
    ? HOST_FROM_CONTAINER
    : String(host).trim();

/** The GeoServer layer (and store) name of a live layer: lowercase, letters, digits, underscore. */
export const liveLayerName = (name) =>
  "live_" +
  String(name)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

const positiveInt = (value, fallback) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/**
 * The connection of a sidecar, checked and made reachable from the containers.
 * @throws {Error} with a sentence about what is wrong
 */
export function normalizeLive(data) {
  const kind = String(data?.kind || "").toLowerCase();
  const srid = positiveInt(data?.srid, 4326);

  if (kind === "postgis") {
    const database = String(data.database || "").trim();
    const table = String(data.table || "").trim();
    if (!database) throw new Error("a PostGIS layer needs its database");
    if (!table) throw new Error("a PostGIS layer needs its table");
    return {
      kind,
      host: reachableHost(data.host || "localhost"),
      port: positiveInt(data.port, 5432),
      database,
      schema: String(data.schema || "public").trim() || "public",
      table,
      user: String(data.user || ""),
      password: String(data.password || ""),
      srid,
    };
  }

  if (kind === "wfs") {
    let url;
    try {
      url = new URL(String(data.url || "").trim());
    } catch {
      throw new Error("a WFS layer needs the address of its service");
    }
    if (!/^https?:$/.test(url.protocol))
      throw new Error("the WFS address must be http(s)");
    const typeName = String(data.typeName || "").trim();
    if (!typeName)
      throw new Error("a WFS layer needs its type name (for example ns:towns)");
    url.hostname = reachableHost(url.hostname).replace(/^\[|\]$/g, "");
    return {
      kind,
      url: url.toString(),
      typeName,
      user: String(data.user || ""),
      password: String(data.password || ""),
      srid,
    };
  }

  throw new Error(`unknown kind "${data?.kind}" (postgis or wfs)`);
}

/**
 * Reads the live-layer sidecars of a staged folder. Entries are shaped like the file
 * reader's own (`name`, `type: "live"`, `hasSld`); one that is unusable is skipped with a
 * warning instead of failing the run.
 */
export function readLiveSidecars(dir) {
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const layers = [];
  for (const file of files
    .filter((f) => f.toLowerCase().endsWith(SUFFIX))
    .sort()) {
    const name = file.slice(0, -SUFFIX.length);
    try {
      const live = normalizeLive(
        JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"))
      );
      layers.push({
        name,
        type: "live",
        hasSld: fs.existsSync(path.join(dir, `${name}.sld`)),
        live,
      });
    } catch (e) {
      console.warn(`Skipping live layer ${file}: ${e.message}`);
    }
  }
  return layers;
}

/**
 * Turns the placeholder WMS layers the DSL declared for the live layers into what the
 * generator draws from the app's own GeoServer (mutates and returns `json`): the layer is
 * no longer "external", it names the GeoServer layer, carries its style, and holds the
 * connection for the server to publish it (never for the client: mini-lps's client
 * template does not copy `live`).
 */
export function applyLiveLayersToSpec(json, liveEntries, manifest = null) {
  const layers = json?.mapViewer?.layers || [];
  for (const entry of liveEntries || []) {
    const layer = layers.find(
      (l) => l.name === `${lowerCamelCase(entry.name)}Layer`
    );
    if (!layer) continue;
    const layerName = liveLayerName(entry.name);
    layer.external = false;
    delete layer.url;
    layer.layers = [layerName];
    layer.live = { ...entry.live, layerName };
    layer.queryable = true;
    /* the parser keeps the id for this kind of layer: the name is the QGIS layer's */
    const title = manifest?.layersByStaged?.[entry.name]?.title;
    if (typeof title === "string" && title.trim()) layer.label = title.trim();
    if (entry.hasSld) {
      const style = `${lowerCamelCase(entry.name)}LayerStyle`;
      layer.availableStyles = [style];
      layer.defaultStyle = style;
    } else {
      layer.availableStyles = [];
      layer.defaultStyle = null;
    }
  }
  return json;
}
