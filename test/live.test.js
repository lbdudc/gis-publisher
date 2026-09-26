import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import gisdslParser from "@lbdudc/gp-gis-dsl";
import {
  applyLiveLayersToSpec,
  liveLayerName,
  normalizeLive,
  reachableHost,
  readLiveSidecars,
  HOST_FROM_CONTAINER,
} from "../src/live-util.js";
import {
  createBaseDSLInstance,
  createBaseTileLayer,
  createLayerDeclarations,
  createMapBlock,
  endDSLInstance,
} from "../src/dsl-util.js";

const postgis = (extra = {}) => ({
  kind: "postgis",
  host: "db.example.org",
  port: 5433,
  database: "gis",
  schema: "geo",
  table: "towns",
  user: "reader",
  password: "s3cret",
  srid: 25829,
  ...extra,
});

test("a source on this machine is reached through the host from the containers", () => {
  for (const loopback of [
    "localhost",
    "LOCALHOST",
    "127.0.0.1",
    "::1",
    "0.0.0.0",
  ]) {
    assert.equal(reachableHost(loopback), HOST_FROM_CONTAINER, loopback);
  }
  assert.equal(reachableHost("db.example.org"), "db.example.org");
  assert.equal(reachableHost("10.0.0.5"), "10.0.0.5");
});

test("names on GeoServer are plain lowercase identifiers", () => {
  assert.equal(liveLayerName("Árboles Urbanos"), "live_arboles_urbanos");
  assert.equal(liveLayerName("pt.svg-2"), "live_pt_svg_2");
  assert.equal(liveLayerName("towns"), "live_towns");
});

test("a PostGIS sidecar is checked and completed", () => {
  const live = normalizeLive(postgis({ host: "localhost" }));
  assert.deepEqual(live, {
    kind: "postgis",
    host: HOST_FROM_CONTAINER,
    port: 5433,
    database: "gis",
    schema: "geo",
    table: "towns",
    user: "reader",
    password: "s3cret",
    srid: 25829,
  });
  const minimal = normalizeLive({ kind: "PostGIS", database: "d", table: "t" });
  assert.equal(minimal.host, HOST_FROM_CONTAINER);
  assert.equal(minimal.port, 5432);
  assert.equal(minimal.schema, "public");
  assert.equal(minimal.srid, 4326);
  assert.throws(() => normalizeLive(postgis({ database: "" })), /database/);
  assert.throws(() => normalizeLive(postgis({ table: " " })), /table/);
});

test("a WFS sidecar needs a service address and a type name", () => {
  const live = normalizeLive({
    kind: "wfs",
    url: "https://example.org/geoserver/wfs?service=WFS",
    typeName: "ns:towns",
    user: "u",
    password: "p",
  });
  assert.equal(live.kind, "wfs");
  assert.equal(live.url, "https://example.org/geoserver/wfs?service=WFS");
  assert.equal(live.srid, 4326);
  assert.equal(
    normalizeLive({
      kind: "wfs",
      url: "http://localhost:8080/wfs",
      typeName: "a:b",
    }).url,
    `http://${HOST_FROM_CONTAINER}:8080/wfs`
  );
  assert.throws(
    () => normalizeLive({ kind: "wfs", url: "not a url", typeName: "a:b" }),
    /address/
  );
  assert.throws(
    () => normalizeLive({ kind: "wfs", url: "ftp://x/y", typeName: "a:b" }),
    /http/
  );
  assert.throws(
    () => normalizeLive({ kind: "wfs", url: "https://x/y" }),
    /type name/
  );
  assert.throws(() => normalizeLive({ kind: "shp" }), /unknown kind/);
});

const stagedFolder = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gp-live-"));
  fs.writeFileSync(
    path.join(dir, "towns.live.json"),
    JSON.stringify(postgis())
  );
  fs.writeFileSync(path.join(dir, "towns.sld"), "<sld/>");
  fs.writeFileSync(
    path.join(dir, "plain.live.json"),
    JSON.stringify({ kind: "wfs", url: "https://x.org/wfs", typeName: "a:b" })
  );
  fs.writeFileSync(path.join(dir, "broken.live.json"), "{not json");
  fs.writeFileSync(
    path.join(dir, "empty.live.json"),
    JSON.stringify({ kind: "postgis" })
  );
  return dir;
};

test("the staged sidecars are read, an unusable one is skipped", () => {
  const dir = stagedFolder();
  const warnings = [];
  const warn = console.warn;
  console.warn = (m) => warnings.push(m);
  try {
    const layers = readLiveSidecars(dir);
    assert.deepEqual(
      layers.map((l) => [l.name, l.type, l.hasSld]),
      [
        ["plain", "live", false],
        ["towns", "live", true],
      ]
    );
    assert.equal(layers[1].live.table, "towns");
  } finally {
    console.warn = warn;
  }
  assert.equal(warnings.length, 2);
  assert.match(warnings.join("|"), /broken\.live\.json/);
  assert.match(warnings.join("|"), /empty\.live\.json/);
  assert.deepEqual(readLiveSidecars(path.join(dir, "nowhere")), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

// The whole path the generator takes: sidecars -> DSL -> parsed spec -> live layers
const specOf = (dir, manifest = null) => {
  const info = readLiveSidecars(dir);
  const dsl =
    createBaseDSLInstance("demo") +
    createBaseTileLayer(null) +
    createLayerDeclarations(info, dir, manifest) +
    createMapBlock(info, "demo", manifest, "Demo") +
    endDSLInstance("demo");
  return {
    info,
    json: applyLiveLayersToSpec(gisdslParser(dsl), info, manifest),
  };
};

test("live layers go through the real DSL and come out as layers of the app's own GeoServer", () => {
  const dir = stagedFolder();
  const warn = console.warn;
  console.warn = () => {};
  const log = console.log;
  console.log = () => {};
  let json;
  try {
    ({ json } = specOf(dir));
  } finally {
    console.warn = warn;
    console.log = log;
  }

  const towns = json.mapViewer.layers.find((l) => l.name === "townsLayer");
  assert.equal(towns.type, "wms");
  assert.equal(towns.external, false);
  assert.equal(
    towns.url,
    undefined,
    "no remote address: it is drawn by the app's GeoServer"
  );
  assert.deepEqual(towns.layers, ["live_towns"]);
  assert.equal(towns.defaultStyle, "townsLayerStyle");
  assert.deepEqual(towns.availableStyles, ["townsLayerStyle"]);
  assert.equal(towns.live.kind, "postgis");
  assert.equal(towns.live.table, "towns");
  assert.equal(towns.live.password, "s3cret");
  assert.equal(towns.live.layerName, "live_towns");
  assert.ok(
    json.mapViewer.styles.some((s) => s.name === "townsLayerStyle"),
    "the QGIS style is a style of the app"
  );

  const plain = json.mapViewer.layers.find((l) => l.name === "plainLayer");
  assert.equal(plain.live.kind, "wfs");
  assert.deepEqual(plain.availableStyles, []);
  assert.equal(plain.defaultStyle, null);

  // and they are on the map, and no entity was made for them
  const map = json.mapViewer.maps[0];
  assert.ok(map.layers.some((l) => l.name === "townsLayer"));
  assert.ok(map.layers.some((l) => l.name === "plainLayer"));
  assert.equal(
    (json.data?.dataModel?.entities || json.dataModel?.entities || []).length,
    0
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a live layer takes its place, title and visibility from the QGIS project", () => {
  const dir = stagedFolder();
  const manifest = {
    layersByStaged: {
      towns: { title: "Towns (live)", order: 2, visible: false },
      plain: { title: "Cities", order: 1 },
    },
  };
  const warn = console.warn;
  console.warn = () => {};
  const log = console.log;
  console.log = () => {};
  let json;
  try {
    ({ json } = specOf(dir, manifest));
  } finally {
    console.warn = warn;
    console.log = log;
  }
  const map = json.mapViewer.maps[0];
  const order = map.layers.filter((l) => !l.baseLayer).map((l) => l.name);
  assert.deepEqual(order, ["plainLayer", "townsLayer"]);
  assert.equal(
    json.mapViewer.layers.find((l) => l.name === "townsLayer").label,
    "Towns (live)"
  );
  assert.equal(map.layers.find((l) => l.name === "townsLayer").selected, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a spec without live layers is not touched", () => {
  const json = {
    mapViewer: {
      layers: [{ name: "aLayer", type: "wms", external: false, layers: ["A"] }],
    },
  };
  const before = JSON.stringify(json);
  applyLiveLayersToSpec(json, []);
  applyLiveLayersToSpec(json, undefined);
  assert.equal(JSON.stringify(json), before);
  applyLiveLayersToSpec({}, [{ name: "x", live: {} }]);
});
