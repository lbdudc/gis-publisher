import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

import gisdslParser from "@lbdudc/gp-gis-dsl";
import { rasterLayerName, assignRasterNames } from "../src/raster-util.js";
import { readTileSidecars } from "../src/tile-util.js";
import {
  createBaseDSLInstance,
  createBaseTileLayer,
  createLayerDeclarations,
  createMapBlock,
  endDSLInstance,
} from "../src/dsl-util.js";

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "gp-test-"));

test("rasterLayerName makes a lowercase ASCII slug with the r_ prefix", () => {
  assert.equal(rasterLayerName("Elevation_Model"), "r_elevation_model");
  assert.equal(
    rasterLayerName("Modelo Elevación (2020)"),
    "r_modelo_elevacion_2020"
  );
  assert.equal(rasterLayerName("01_sample"), "r_01_sample");
  assert.equal(rasterLayerName("***"), "r_raster");
});

test("rasterLayerName keeps names of colliding rasters apart", () => {
  const used = new Set();
  assert.equal(rasterLayerName("Dem 1", used), "r_dem_1");
  assert.equal(rasterLayerName("dem-1", used), "r_dem_1_2");
  assert.equal(rasterLayerName("DEM_1", used), "r_dem_1_3");
});

test("assignRasterNames only names the GeoTIFFs, across directories", () => {
  const names = assignRasterNames([
    [
      { name: "dem", type: "geoTIFF" },
      { name: "roads", type: "shapefile" },
    ],
    [{ name: "DEM", type: "geoTIFF" }],
  ]);
  assert.deepEqual(
    [...names],
    [
      ["dem", "r_dem"],
      ["DEM", "r_dem_2"],
    ]
  );
});

test("readTileSidecars reads valid sidecars and skips the unusable ones", () => {
  const dir = tmpDir();
  fs.writeFileSync(
    path.join(dir, "topo.tiles.json"),
    JSON.stringify({
      url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
      attribution: "<a href='x'>OpenTopoMap</a>",
      zmin: 0,
      zmax: 17,
    })
  );
  fs.writeFileSync(
    path.join(dir, "quadkey.tiles.json"),
    JSON.stringify({ url: "https://t.example/{q}.png" })
  );
  fs.writeFileSync(path.join(dir, "broken.tiles.json"), "not json");
  fs.writeFileSync(path.join(dir, "other.json"), "{}");

  const originalWarn = console.warn;
  console.warn = () => {};
  let layers;
  try {
    layers = readTileSidecars(dir);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(layers.length, 1);
  assert.equal(layers[0].name, "topo");
  assert.equal(layers[0].type, "xyz");
  assert.equal(layers[0].xyz.zmax, 17);
});

test("a raster and an XYZ layer go through the DSL parser", () => {
  const originalLog = console.log;
  console.log = () => {};
  try {
    const rasterNames = new Map([["Elevation", "r_elevation"]]);
    const info = [
      { name: "Elevation", type: "geoTIFF", hasSld: true },
      { name: "Hillshade", type: "geoTIFF", hasSld: false },
      {
        name: "topo",
        type: "xyz",
        hasSld: false,
        xyz: {
          url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
          attribution: `<a href="https://x">Map "data" & 'more'</a>`,
          zmin: 0,
          zmax: 17,
        },
      },
    ];
    rasterNames.set("Hillshade", "r_hillshade");

    const dsl =
      createBaseDSLInstance("demo") +
      createBaseTileLayer() +
      createLayerDeclarations(info, "/tmp/staged", null, rasterNames) +
      createMapBlock(info, "main", null, "Main") +
      endDSLInstance("demo");

    assert.match(dsl, /CREATE RASTER LAYER elevationLayer AS "Elevation"/);
    assert.match(dsl, /layerName "r_elevation",\s+style elevationLayerStyle/);
    // no SLD, no style: GeoServer's default raster style applies
    assert.match(
      dsl,
      /CREATE RASTER LAYER hillshadeLayer[^;]*layerName "r_hillshade"\s*\);/
    );
    assert.doesNotMatch(dsl, /hillshadeLayerStyle/);

    const spec = gisdslParser(dsl);
    const layers = Object.fromEntries(
      spec.mapViewer.layers.map((l) => [l.name, l])
    );

    assert.equal(layers.elevationLayer.raster, true);
    assert.deepEqual(layers.elevationLayer.layers, ["r_elevation"]);
    assert.equal(layers.elevationLayer.defaultStyle, "elevationLayerStyle");
    assert.equal(layers.hillshadeLayer.defaultStyle, null);

    assert.equal(layers.topoLayer.type, "tilelayer");
    assert.equal(layers.topoLayer.options.maxNativeZoom, 17);
    // quotes can't survive in the DSL text: tags are dropped, quotes become entities
    assert.equal(
      layers.topoLayer.options.attribution,
      "Map &quot;data&quot; & &#39;more&#39;"
    );
  } finally {
    console.log = originalLog;
  }
});

test("a raster with no assigned name is an error, not a silent wrong name", () => {
  const originalLog = console.log;
  console.log = () => {};
  try {
    assert.throws(
      () =>
        createLayerDeclarations(
          [{ name: "dem", type: "geoTIFF", hasSld: false }],
          "/tmp/staged",
          null,
          new Map()
        ),
      /No GeoServer layer name/
    );
  } finally {
    console.log = originalLog;
  }
});
