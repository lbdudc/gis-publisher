import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

import { scopeWmsLayers } from "../src/wms-util.js";

const URL_IGN = "https://www.ign.es/wms-inspire/pnoa-ma";

const layer = (layerName, extra = {}) => ({
  url: URL_IGN,
  layerName,
  layerTitle: layerName.toLowerCase(),
  styles: ["default", "alt"],
  ...extra,
});

const wmsInfo = () => ({
  name: "urls",
  type: "wms",
  schema: [
    layer("OI.MosaicElement"),
    layer("OI.OrthoimageCoverage"),
    layer("fondo"),
  ],
});

function stage(requests) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gp-wms-"));
  if (requests !== undefined) {
    fs.writeFileSync(
      path.join(dir, "urls.wms.json"),
      typeof requests === "string" ? requests : JSON.stringify(requests)
    );
  }
  return dir;
}

test("only the sublayer picked in QGIS is kept", () => {
  const dir = stage([{ url: URL_IGN, layers: ["fondo"], styles: [] }]);
  const [info] = scopeWmsLayers([wmsInfo()], dir);
  assert.deepEqual(
    info.schema.map((l) => l.layerName),
    ["fondo"]
  );
});

test("several layers of one service keep all the picked ones", () => {
  const dir = stage([
    { url: URL_IGN, layers: ["fondo"] },
    { url: URL_IGN, layers: ["OI.OrthoimageCoverage"] },
  ]);
  const [info] = scopeWmsLayers([wmsInfo()], dir);
  assert.deepEqual(
    info.schema.map((l) => l.layerName),
    ["OI.OrthoimageCoverage", "fondo"]
  );
});

test("the style picked in QGIS goes first", () => {
  const dir = stage([{ url: URL_IGN, layers: ["fondo"], styles: ["alt"] }]);
  const [info] = scopeWmsLayers([wmsInfo()], dir);
  assert.deepEqual(info.schema[0].styles, ["alt", "default"]);
});

test("without a sidecar, or with a broken one, the whole service is kept", () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    for (const dir of [
      stage(undefined),
      stage("not json"),
      stage({ not: "a list" }),
    ]) {
      const [info] = scopeWmsLayers([wmsInfo()], dir);
      assert.equal(info.schema.length, 3);
    }
  } finally {
    console.warn = originalWarn;
  }
});

test("a request that names no sublayer keeps the whole service", () => {
  const dir = stage([{ url: URL_IGN, layers: [] }]);
  const [info] = scopeWmsLayers([wmsInfo()], dir);
  assert.equal(info.schema.length, 3);
});

test("a picked sublayer the service doesn't have keeps the whole service", () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const dir = stage([{ url: URL_IGN, layers: ["gone"] }]);
    const [info] = scopeWmsLayers([wmsInfo()], dir);
    assert.equal(info.schema.length, 3);
  } finally {
    console.warn = originalWarn;
  }
});

test("another service the sidecar doesn't mention is left alone", () => {
  const other = {
    name: "urls",
    type: "wms",
    schema: [layer("a", { url: "https://other/wms" })],
  };
  const dir = stage([{ url: URL_IGN, layers: ["fondo"] }]);
  const [scoped, untouched] = scopeWmsLayers([wmsInfo(), other], dir);
  assert.equal(scoped.schema.length, 1);
  assert.equal(untouched.schema.length, 1);
});

test("non-WMS entries pass through", () => {
  const shp = {
    name: "roads",
    type: "shapefile",
    schema: [{ name: "geometry" }],
  };
  const dir = stage([{ url: URL_IGN, layers: ["fondo"] }]);
  assert.deepEqual(scopeWmsLayers([shp], dir), [shp]);
});
