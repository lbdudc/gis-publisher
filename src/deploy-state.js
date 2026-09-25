import crypto from "crypto";
import fs from "fs";
import path from "path";

// Next to the generated product: what shape of data model the deployed database holds
const STATE_FILE = ".gp-deploy-state.json";

/**
 * Fingerprint of what defines the database's tables: each entity's properties (name and
 * type) and the SRID. The data itself is not part of it (the importer reloads a changed
 * layer on its own), and neither are labels/aliases, which never touch the schema.
 * @param {Object} spec The parsed spec the product is generated from
 * @returns {String}
 */
export function dataModelFingerprint(spec) {
  const entities = (spec?.data?.dataModel?.entities || [])
    .map((entity) => ({
      name: entity.name,
      properties: (entity.properties || []).map((p) => [
        p.name,
        p.class,
        !!p.pk,
      ]),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ srid: spec?.basicData?.SRID ?? null, entities }))
    .digest("hex");
}

/**
 * Whether the deployment must start from an empty database (`docker compose down -v`).
 * A redeploy keeps the database -- and the importer only reloads the layers whose data
 * changed -- unless the tables would no longer match the data model: Hibernate's
 * `ddl-auto: update` adds columns but never changes or drops one, so a changed layer
 * schema needs a clean database. An explicit `deploy.resetData` in the config wins.
 * @param {String} outputDir
 * @param {String} fingerprint
 * @param {Boolean|undefined} configured `resetData` from the deploy config
 * @returns {{resetData: Boolean, reason: String|null}}
 */
export function decideResetData(outputDir, fingerprint, configured) {
  if (typeof configured === "boolean") {
    return {
      resetData: configured,
      reason: configured ? "requested by the deploy configuration" : null,
    };
  }

  let previous = null;
  try {
    previous = JSON.parse(
      fs.readFileSync(path.join(outputDir, STATE_FILE), "utf-8")
    ).dataModel;
  } catch {
    // never deployed from here: nothing to compare with
  }

  if (!previous) {
    return {
      resetData: true,
      reason: "no previous deployment recorded for this product",
    };
  }
  if (previous !== fingerprint) {
    return { resetData: true, reason: "the data model changed" };
  }
  return { resetData: false, reason: null };
}

/** Records the data model that the deployed database now holds (call after a good deploy). */
export function saveDeployState(outputDir, fingerprint) {
  fs.writeFileSync(
    path.join(outputDir, STATE_FILE),
    JSON.stringify({ dataModel: fingerprint }, null, 2),
    "utf-8"
  );
}
