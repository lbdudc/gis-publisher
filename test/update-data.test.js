import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { checkDataUpdate } from "../src/update-data.js";
import {
  planImportData,
  createImportStaging,
  copyGeographicDataForImport,
} from "../src/import-util.js";

const product = ({
  fingerprint = "fp1",
  files = { "a.zip": "h1", "b.zip": "h2" },
  state = true,
} = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gp-update-"));
  if (state)
    fs.writeFileSync(
      path.join(dir, ".gp-deploy-state.json"),
      JSON.stringify({ dataModel: fingerprint })
    );
  const data = path.join(dir, "deploy", "importer", "data");
  fs.mkdirSync(data, { recursive: true });
  if (files)
    fs.writeFileSync(
      path.join(data, "manifest.json"),
      JSON.stringify({ version: 1, files })
    );
  return dir;
};

test("the same layers and fields can be updated", () => {
  const outputDir = product();
  assert.deepEqual(
    checkDataUpdate({
      outputDir,
      fingerprint: "fp1",
      plannedFiles: ["b.zip", "a.zip"],
    }),
    { ok: true }
  );
});

test("an app never deployed from here cannot be updated", () => {
  for (const outputDir of [
    product({ state: false }),
    product({ files: null }),
    path.join(os.tmpdir(), "gp-nope"),
  ]) {
    const verdict = checkDataUpdate({
      outputDir,
      fingerprint: "fp1",
      plannedFiles: ["a.zip", "b.zip"],
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /deploy it first/);
  }
});

test("changed fields need a full deploy", () => {
  const verdict = checkDataUpdate({
    outputDir: product(),
    fingerprint: "fp2",
    plannedFiles: ["a.zip", "b.zip"],
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /fields changed.*use Deploy/s);
});

test("added or removed layers need a full deploy", () => {
  const added = checkDataUpdate({
    outputDir: product(),
    fingerprint: "fp1",
    plannedFiles: ["a.zip", "b.zip", "c.zip"],
  });
  assert.equal(added.ok, false);
  assert.match(added.reason, /added or removed.*c\.zip/s);
  const removed = checkDataUpdate({
    outputDir: product(),
    fingerprint: "fp1",
    plannedFiles: ["a.zip"],
  });
  assert.equal(removed.ok, false);
  assert.match(removed.reason, /b\.zip/);
});

test("planImportData lists the importer files without copying any data", () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "gp-src-"));
  fs.mkdirSync(path.join(source, "output"));
  fs.writeFileSync(
    path.join(source, "output", "roads.zip"),
    "not really a zip"
  );
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "gp-out-"));
  const planned = planImportData([source], out, new Map());
  assert.deepEqual(Object.keys(planned), ["roads.zip"]);
  assert.ok(
    !fs.existsSync(path.join(out, "deploy", "importer", "data", "roads.zip"))
  );
  // and the real staging still copies it afterwards
  const staging = createImportStaging(out);
  copyGeographicDataForImport(source, out, new Map(), staging);
  staging.finish();
  assert.ok(
    fs.existsSync(path.join(out, "deploy", "importer", "data", "roads.zip"))
  );
});

import { editedLayersInfo } from "../src/import-util.js";

test("edited layers are named for the importer, and overwriting is opt-in", () => {
  const manifest = {
    layersByStaged: {
      ciudades: { staged: "ciudades", editable: true },
      roads: { staged: "roads" },
    },
  };
  assert.deepEqual(editedLayersInfo(manifest), {
    editable: ["ciudades.zip"],
    overwriteEdited: false,
  });
  assert.deepEqual(
    editedLayersInfo(manifest, { overwriteEditedLayers: true }),
    {
      editable: ["ciudades.zip"],
      overwriteEdited: true,
    }
  );
  assert.deepEqual(
    editedLayersInfo({ layersByStaged: { a: { staged: "a" } } }),
    {}
  );
  assert.deepEqual(editedLayersInfo(null), {});
});

test("the staging manifest carries that information", () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "gp-src-"));
  fs.mkdirSync(path.join(source, "output"));
  fs.writeFileSync(path.join(source, "output", "ciudades.zip"), "zip");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "gp-out-"));
  const staging = createImportStaging(out);
  copyGeographicDataForImport(source, out, new Map(), staging);
  staging.finish({ editable: ["ciudades.zip"], overwriteEdited: false });
  const written = JSON.parse(
    fs.readFileSync(
      path.join(out, "deploy", "importer", "data", "manifest.json"),
      "utf-8"
    )
  );
  assert.deepEqual(written.editable, ["ciudades.zip"]);
  assert.equal(written.overwriteEdited, false);
  assert.ok(written.files["ciudades.zip"]);
});
