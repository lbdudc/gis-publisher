import { test } from "node:test";
import assert from "node:assert/strict";
import { applyManifestToSpec } from "../src/manifest-util.js";

const spec = () => ({
  data: {
    dataModel: {
      entities: [
        {
          name: "Municipios",
          properties: [
            { name: "id", class: "Long (autoinc)" },
            { name: "nombre", class: "String" },
            { name: "codTipo", class: "String" },
            { name: "id2", class: "Long" },
          ],
        },
      ],
    },
  },
  mapViewer: { layers: [{ name: "municipiosLayer", type: "wms" }] },
});

const manifest = (entry) => ({ layersByStaged: { municipios: entry } });

test("hidden columns and value maps go onto the matching properties", () => {
  const json = applyManifestToSpec(
    spec(),
    manifest({
      fields: [
        { name: "nombre", hidden: true },
        { name: "COD_TIPO", valueMap: { 1: "Urban", 2: "Rural" } },
        { name: "id", hidden: true },
        { name: "missing", hidden: true },
      ],
    })
  );
  const props = Object.fromEntries(
    json.data.dataModel.entities[0].properties.map((p) => [p.name, p])
  );
  assert.equal(props.nombre.hidden, true);
  assert.equal(props.id2.hidden, true); /* a DBF "id" becomes id2 */
  assert.equal(props.id.hidden, undefined);
});

test("value maps match the camel-cased property name", () => {
  const json = spec();
  json.data.dataModel.entities[0].properties.push({
    name: "codTipo2",
    class: "String",
  });
  applyManifestToSpec(
    json,
    manifest({
      fields: [{ name: "cod_tipo", valueMap: { 1: "Urban", "": "x", 2: 5 } }],
    })
  );
  const prop = json.data.dataModel.entities[0].properties.find(
    (p) => p.name === "codTipo"
  );
  assert.deepEqual(prop.valueMap, {
    1: "Urban",
  }); /* only text labels, no empty codes */
});

test("the map tip goes on the layer with property names in its placeholders", () => {
  const json = applyManifestToSpec(
    spec(),
    manifest({
      popup: { template: "<b>{{nombre}}</b> {{COD_TIPO}} {{unknown}}" },
    })
  );
  assert.deepEqual(json.mapViewer.layers[0].popup, {
    template: "<b>{{nombre}}</b> {{codTipo}} ",
  });
});

test("nothing to apply changes nothing", () => {
  const before = JSON.stringify(spec());
  assert.equal(JSON.stringify(applyManifestToSpec(spec(), null)), before);
  assert.equal(
    JSON.stringify(applyManifestToSpec(spec(), manifest({}))),
    before
  );
  assert.equal(
    JSON.stringify(
      applyManifestToSpec(spec(), {
        layersByStaged: { other: { popup: { template: "x" } } },
      })
    ),
    before
  );
});

import { hasTemporalLayers } from "../src/manifest-util.js";

const timedSpec = () => {
  const json = spec();
  json.data.dataModel.entities[0].properties.push(
    { name: "founded", class: "Date" },
    { name: "closed", class: "Date" }
  );
  return json;
};

test("a temporal layer gets its time properties", () => {
  const json = applyManifestToSpec(
    timedSpec(),
    manifest({ temporal: { startField: "FOUNDED", endField: "closed" } })
  );
  assert.deepEqual(json.mapViewer.layers[0].temporal, {
    start: "founded",
    end: "closed",
  });
  assert.equal(hasTemporalLayers(json), true);
  const instant = applyManifestToSpec(
    timedSpec(),
    manifest({ temporal: { startField: "founded" } })
  );
  assert.deepEqual(instant.mapViewer.layers[0].temporal, { start: "founded" });
});

test("time fields that are not dates change nothing", () => {
  for (const temporal of [
    { startField: "nombre" },
    { startField: "founded", endField: "nombre" },
    { startField: "gone" },
    {},
  ]) {
    const json = applyManifestToSpec(timedSpec(), manifest({ temporal }));
    assert.equal(
      json.mapViewer.layers[0].temporal,
      undefined,
      JSON.stringify(temporal)
    );
    assert.equal(hasTemporalLayers(json), false);
  }
});

import { hasEditableLayers } from "../src/manifest-util.js";

test("an editable layer is marked, and only when it has its entity", () => {
  const json = applyManifestToSpec(spec(), manifest({ editable: true }));
  assert.equal(json.mapViewer.layers[0].editable, true);
  assert.equal(hasEditableLayers(json), true);

  for (const entry of [{}, { editable: false }, { editable: "yes" }]) {
    const other = applyManifestToSpec(spec(), manifest(entry));
    assert.equal(hasEditableLayers(other), false, JSON.stringify(entry));
  }
  const noEntity = spec();
  noEntity.data.dataModel.entities = [];
  assert.equal(
    hasEditableLayers(
      applyManifestToSpec(noEntity, manifest({ editable: true }))
    ),
    false
  );
});
