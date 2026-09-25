import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  appOptionsFromManifest,
  applyFeatureOptions,
  applyBrandingToSpec,
  basemapFromManifest,
  brandingFromManifest,
  BASEMAPS,
} from "../src/options-util.js";
import { createBaseTileLayer } from "../src/dsl-util.js";
import { stageBrandingLogo } from "../src/branding-util.js";

const manifest = (project) => ({ project, layersByStaged: {} });

test("options default to search/legend/downloads on, geocoder off", () => {
  assert.deepEqual(appOptionsFromManifest(null), {
    search: true,
    geocoder: false,
    legend: true,
    downloads: true,
  });
  assert.equal(
    appOptionsFromManifest(manifest({ options: { legend: "no" } })).legend,
    true
  );
});

test("feature options add and remove features", () => {
  const base = ["MapViewer", "MV_T_E_ShowLegend"];
  const on = applyFeatureOptions(base, {
    search: true,
    geocoder: true,
    legend: true,
    downloads: true,
  });
  for (const f of [
    "MV_T_Filterable",
    "MV_T_F_BasicSearch",
    "MV_T_F_Geocoder",
    "MV_T_E_ShowLegend",
    "DM_DataExport",
  ]) {
    assert.ok(on.includes(f), f);
  }
  const off = applyFeatureOptions(base, {
    search: false,
    geocoder: false,
    legend: false,
    downloads: false,
  });
  assert.deepEqual(off, ["MapViewer"]);
});

test("branding keeps only valid values", () => {
  assert.deepEqual(
    brandingFromManifest(
      manifest({
        branding: {
          title: "  Río\nAlto ",
          primaryColor: "#1a2B3c",
          logo: "logo.PNG",
        },
      })
    ),
    { title: "Río Alto", primaryColor: "#1a2B3c", logo: "logo.PNG" }
  );
  assert.deepEqual(
    brandingFromManifest(
      manifest({
        branding: { title: " ", primaryColor: "red", logo: "../x.png" },
      })
    ),
    {}
  );
  assert.deepEqual(
    brandingFromManifest(manifest({ branding: { logo: "logo.exe" } })),
    {}
  );
});

test("branding goes to basicData.extra and leaves the name alone", () => {
  const json = { basicData: { name: "demo", extra: { a: 1 } } };
  applyBrandingToSpec(
    json,
    manifest({ branding: { title: "Demo Map", primaryColor: "#112233" } }),
    { logoUrl: "img/branding/logo.png" }
  );
  assert.deepEqual(json.basicData, {
    name: "demo",
    extra: { a: 1, app_title: "Demo Map", primary_color: "#112233" },
  });
});

test("the basemap falls back to OpenStreetMap", () => {
  assert.equal(basemapFromManifest(null), BASEMAPS.osm);
  assert.equal(
    basemapFromManifest(manifest({ branding: { basemap: "nope" } })),
    BASEMAPS.osm
  );
  assert.equal(
    basemapFromManifest(manifest({ branding: { basemap: "esri-dark" } })),
    BASEMAPS["esri-dark"]
  );
});

test("createBaseTileLayer writes the chosen basemap with its options", () => {
  const dsl = createBaseTileLayer(BASEMAPS["opentopo"]);
  assert.match(dsl, /CREATE TILE LAYER base AS "OpenTopoMap"/);
  assert.match(dsl, /"subdomains" "abc"/);
  assert.match(dsl, /"maxNativeZoom" "17"/);
  assert.match(createBaseTileLayer(), /AS "OpenStreetMap"/);
});

test("stageBrandingLogo copies the logo and replaces older ones", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gp-brand-"));
  const out = path.join(root, "out");
  fs.mkdirSync(path.join(root, "branding"), { recursive: true });
  fs.writeFileSync(path.join(root, "branding", "logo.png"), "png");
  const m = manifest({ branding: { logo: "logo.png" } });

  const stale = path.join(out, "client/public/img/branding/old.svg");
  fs.mkdirSync(path.dirname(stale), { recursive: true });
  fs.writeFileSync(stale, "old");

  assert.equal(stageBrandingLogo(root, m), true); // check only
  assert.ok(fs.existsSync(stale));
  assert.equal(stageBrandingLogo(root, m, out), true);
  assert.ok(
    fs.existsSync(path.join(out, "client/public/img/branding/logo.png"))
  );
  assert.ok(!fs.existsSync(stale));

  assert.equal(
    stageBrandingLogo(root, manifest({ branding: { logo: "missing.png" } })),
    false
  );
  fs.rmSync(root, { recursive: true, force: true });
});

import { pickDisplayField, createEntityScheme } from "../src/dsl-util.js";

const schema = (...names) =>
  names.map((name) => ({
    name,
    type:
      name === "geometry"
        ? "MultiPolygon"
        : name.startsWith("n_")
        ? "Number"
        : "String",
  }));

test("the display field follows the QGIS layer's display field when it exists", () => {
  const fields = schema("fid", "nameunit", "concello", "geometry");
  assert.equal(
    pickDisplayField(fields, { displayField: "concello" }),
    "concello"
  );
  assert.equal(
    pickDisplayField(fields, { displayField: "CONCELLO" }),
    "concello"
  );
  assert.equal(
    pickDisplayField(fields, { displayField: "geometry" }),
    "nameunit"
  );
});

test("without one, the field that looks most like a name is used", () => {
  assert.equal(
    pickDisplayField(schema("fid", "natlevname", "nameunit", "provincia")),
    "nameunit"
  );
  assert.equal(pickDisplayField(schema("fid", "nombre2", "name")), "name");
  assert.equal(pickDisplayField(schema("fid", "natlevname")), "natlevname");
  assert.equal(pickDisplayField(schema("fid", "provincia", "geometry")), null);
  assert.equal(pickDisplayField(schema("n_name", "id")), null);
  assert.equal(pickDisplayField([]), null);
});

test("createEntityScheme marks the display field, or the id when there is none", () => {
  const named = createEntityScheme([
    { name: "muni", schema: schema("fid", "nombre", "geometry") },
  ]);
  assert.match(named, /id Long IDENTIFIER,/);
  assert.match(named, /nombre String DISPLAY_STRING/);
  const plain = createEntityScheme([
    { name: "muni", schema: schema("fid", "geometry") },
  ]);
  assert.match(plain, /id Long IDENTIFIER DISPLAY_STRING/);
  const aliased = createEntityScheme(
    [{ name: "muni", schema: schema("fid", "nombre", "geometry") }],
    {
      layersByStaged: {
        muni: { fields: [{ name: "nombre", alias: "Nombre" }] },
      },
    }
  );
  assert.match(aliased, /nombre String DISPLAY_STRING AS "Nombre"/);
});

import { normalizeSpecTypes } from "../src/dsl-util.js";

test("LocalDate properties become the Date class the templates know", () => {
  const json = {
    data: {
      dataModel: {
        entities: [
          {
            properties: [
              { class: "LocalDate" },
              { class: "Double" },
              { class: "Boolean" },
            ],
          },
        ],
      },
    },
  };
  normalizeSpecTypes(json);
  assert.deepEqual(
    json.data.dataModel.entities[0].properties.map((p) => p.class),
    ["Date", "Double", "Boolean"]
  );
  assert.deepEqual(normalizeSpecTypes({}), {});
});

test("createEntityScheme writes the reader's new types", () => {
  const dsl = createEntityScheme([
    {
      name: "muni",
      schema: [
        { name: "pop", type: "Number" },
        { name: "area", type: "Double" },
        { name: "founded", type: "Date" },
        { name: "active", type: "Boolean" },
        { name: "geometry", type: "MultiPolygon" },
      ],
    },
  ]);
  assert.match(dsl, /pop Long/);
  assert.match(dsl, /area Double/);
  assert.match(dsl, /founded LocalDate/);
  assert.match(dsl, /active Boolean/);
});
