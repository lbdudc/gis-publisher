import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";

import { readZipEntries, zipContentHash, fileHash } from "../src/data-hash.js";
import {
  copyGeographicDataForImport,
  createImportStaging,
} from "../src/import-util.js";
import {
  dataModelFingerprint,
  decideResetData,
  saveDeployState,
} from "../src/deploy-state.js";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/**
 * Minimal zip writer. `mtime` goes into the DOS date/time fields, which is exactly what
 * differs between two exports of the same data.
 */
function makeZip(entries, { mtime = 0, deflate = true } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content);
    const packed = deflate ? zlib.deflateRawSync(data) : data;
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(mtime, 10);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(mtime, 12);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

/** A DBF-like blob: byte 0 version, bytes 1-3 last-update date, then the records. */
const dbf = (date, records) =>
  Buffer.concat([Buffer.from([3, ...date]), Buffer.from(records)]);

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "gp-staging-"));

test("readZipEntries reads deflated and stored entries", () => {
  for (const deflate of [true, false]) {
    const entries = readZipEntries(
      makeZip({ "a.shp": "shape data", "a.prj": "WGS84" }, { deflate })
    );
    assert.deepEqual(
      entries.map((e) => [e.name, e.data.toString()]),
      [
        ["a.shp", "shape data"],
        ["a.prj", "WGS84"],
      ]
    );
  }
});

test("zipContentHash ignores zip timestamps and the DBF's last-update date", () => {
  const dir = tmp();
  try {
    const write = (name, entries, opts) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, makeZip(entries, opts));
      return zipContentHash(file);
    };
    const monday = { "l.shp": "geometry", "l.dbf": dbf([26, 9, 21], "rows") };
    const tuesday = { "l.dbf": dbf([26, 9, 22], "rows"), "l.shp": "geometry" };

    const a = write("a.zip", monday, { mtime: 111 });
    const b = write("b.zip", tuesday, { mtime: 999 });
    assert.equal(a, b);
    assert.match(a, /^z1:/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("zipContentHash changes when the data does", () => {
  const dir = tmp();
  try {
    const hash = (entries) => {
      const file = path.join(dir, "x.zip");
      fs.writeFileSync(file, makeZip(entries));
      return zipContentHash(file);
    };
    const base = hash({ "l.shp": "geometry", "l.dbf": dbf([1, 2, 3], "rows") });
    assert.notEqual(
      base,
      hash({ "l.shp": "geometry", "l.dbf": dbf([1, 2, 3], "other rows") })
    );
    assert.notEqual(
      base,
      hash({ "l.shp": "moved", "l.dbf": dbf([1, 2, 3], "rows") })
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("zipContentHash falls back to the file's bytes for something that is not a zip", () => {
  const dir = tmp();
  try {
    const file = path.join(dir, "bad.zip");
    fs.writeFileSync(file, "definitely not a zip");
    assert.match(zipContentHash(file), /^f1:/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** A staged folder shaped like the geographic-info-reader's output. */
function stageSource(root, name, entries, opts) {
  const folder = path.join(root, name, "output");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `${name}.zip`), makeZip(entries, opts));
  return path.join(root, name);
}

test("a redeploy leaves unchanged files alone and replaces changed ones", () => {
  const root = tmp();
  const cwd = process.cwd();
  try {
    const out = path.join(root, "out");
    const data = path.join(out, "deploy", "importer", "data");
    const run = (sources) => {
      const staging = createImportStaging(out);
      for (const s of sources) {
        copyGeographicDataForImport(s, out, new Map(), staging);
      }
      staging.finish();
      return JSON.parse(
        fs.readFileSync(path.join(data, "manifest.json"), "utf-8")
      ).files;
    };

    const roads = { "roads.shp": "roads v1", "roads.dbf": dbf([1, 1, 1], "r") };
    const towns = { "towns.shp": "towns v1" };

    // first run
    let files = run([
      stageSource(path.join(root, "s1"), "roads", roads, { mtime: 1 }),
      stageSource(path.join(root, "s1"), "towns", towns, { mtime: 1 }),
    ]);
    assert.deepEqual(Object.keys(files).sort(), ["roads.zip", "towns.zip"]);
    const first = fs.readFileSync(path.join(data, "roads.zip"));
    // pin an old mtime: an untouched file keeps it
    const old = new Date("2020-01-01");
    fs.utimesSync(path.join(data, "roads.zip"), old, old);

    // same data exported again (new timestamps, new DBF date), towns changed, roads kept
    files = run([
      stageSource(
        path.join(root, "s2"),
        "roads",
        { ...roads, "roads.dbf": dbf([2, 2, 2], "r") },
        { mtime: 2 }
      ),
      stageSource(
        path.join(root, "s2"),
        "towns",
        { "towns.shp": "towns v2" },
        {
          mtime: 2,
        }
      ),
    ]);
    assert.deepEqual(fs.readFileSync(path.join(data, "roads.zip")), first);
    assert.equal(
      fs.statSync(path.join(data, "roads.zip")).mtime.getTime(),
      old.getTime()
    );
    assert.notEqual(files["towns.zip"], undefined);
    assert.match(
      readZipEntries(
        fs.readFileSync(path.join(data, "towns.zip"))
      )[0].data.toString(),
      /towns v2/
    );

    // a layer removed from the project is no longer imported
    files = run([
      stageSource(path.join(root, "s3"), "roads", roads, { mtime: 3 }),
    ]);
    assert.deepEqual(Object.keys(files), ["roads.zip"]);
    assert.equal(fs.existsSync(path.join(data, "towns.zip")), false);

    // ...and a project with no data at all leaves no data folder behind
    const empty = createImportStaging(out);
    empty.finish();
    assert.equal(fs.existsSync(data), false);
  } finally {
    process.chdir(cwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rasters are staged under their layer name with a file hash", () => {
  const root = tmp();
  try {
    const src = path.join(root, "src", "output");
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, "dem.tif"), "tiff bytes");
    const out = path.join(root, "out");

    copyGeographicDataForImport(
      path.join(root, "src"),
      out,
      new Map([["dem", "r_dem"]])
    );

    const staged = path.join(
      out,
      "deploy",
      "importer",
      "data",
      "rasters",
      "r_dem.tif"
    );
    assert.equal(fs.readFileSync(staged, "utf-8"), "tiff bytes");
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(out, "deploy", "importer", "data", "manifest.json"),
        "utf-8"
      )
    );
    assert.deepEqual(manifest.files, { "rasters/r_dem.tif": fileHash(staged) });
    assert.ok(
      fs.existsSync(path.join(out, "deploy", "importer", "import.mjs"))
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const spec = (properties, extra = {}) => ({
  basicData: { SRID: 4326, ...extra },
  data: {
    dataModel: {
      entities: [
        { name: "Roads", properties, displayString: "$id" },
        {
          name: "Towns",
          properties: [{ name: "id", class: "Long", pk: true }],
        },
      ],
    },
  },
});
const props = [
  { name: "id", class: "Long (autoinc)", pk: true },
  { name: "name", class: "String" },
];

test("the fingerprint follows the table schema, not labels or entity order", () => {
  const base = dataModelFingerprint(spec(props));
  assert.equal(base, dataModelFingerprint(spec(props)));
  // a label/alias doesn't touch the tables
  assert.equal(
    base,
    dataModelFingerprint(
      spec(props.map((p) => ({ ...p, displayName: "Nice label" })))
    )
  );
  const reordered = spec(props);
  reordered.data.dataModel.entities.reverse();
  assert.equal(base, dataModelFingerprint(reordered));

  assert.notEqual(
    base,
    dataModelFingerprint(spec([...props, { name: "pop", class: "Long" }]))
  );
  assert.notEqual(
    base,
    dataModelFingerprint(spec([props[0], { name: "name", class: "Long" }]))
  );
  assert.notEqual(base, dataModelFingerprint(spec(props, { SRID: 3857 })));
});

test("the database is kept unless the data model changed", () => {
  const dir = tmp();
  try {
    const fingerprint = dataModelFingerprint(spec(props));

    // nothing recorded: start clean, like every deploy used to
    assert.deepEqual(decideResetData(dir, fingerprint, undefined), {
      resetData: true,
      reason: "no previous deployment recorded for this product",
    });

    saveDeployState(dir, fingerprint);
    assert.deepEqual(decideResetData(dir, fingerprint, undefined), {
      resetData: false,
      reason: null,
    });

    const changed = dataModelFingerprint(
      spec([...props, { name: "x", class: "String" }])
    );
    assert.deepEqual(decideResetData(dir, changed, undefined), {
      resetData: true,
      reason: "the data model changed",
    });

    // an explicit setting always wins
    assert.equal(decideResetData(dir, changed, false).resetData, false);
    assert.equal(decideResetData(dir, fingerprint, true).resetData, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
