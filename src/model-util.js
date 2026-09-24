import fs from "fs";
import path from "path";

const MODELS_DEST_RELATIVE = path.join("server", "models");

/**
 * Retrieves all .model3 files from a folder and returns their paths.
 * @param {string} modelsFolder - Absolute path to the models folder.
 * @returns {string[]} Array of .model3 file names found in the folder.
 */
export function getModelsFromFolder(modelsFolder) {
  if (!fs.existsSync(modelsFolder)) {
    console.warn(`The models folder "${modelsFolder}" does not exist`);
    return [];
  }

  const files = fs.readdirSync(modelsFolder);
  const modelFiles = files.filter(
    (file) => path.extname(file).toLowerCase() === ".model3"
  );

  if (modelFiles.length === 0) {
    console.warn(`No .model3 files found in "${modelsFolder}"`);
  }

  return modelFiles;
}

/**
 * Copies all .model3 files from modelsFolder into <outputFolder>/server/models/.
 * Creates the destination directory if it does not exist.
 * @param {string} modelsFolder - Source folder containing .model3 files.
 * @param {string} outputFolder - Root of the generated product.
 */
export function copyModelFiles(modelsFolder, outputFolder) {
  const modelFiles = getModelsFromFolder(modelsFolder);
  if (modelFiles.length === 0) return;

  const destFolder = path.join(outputFolder, MODELS_DEST_RELATIVE);

  if (!fs.existsSync(destFolder)) {
    fs.mkdirSync(destFolder, { recursive: true });
    console.info(`Created models destination folder: ${destFolder}`);
  }

  // Regenerating into an existing output must not leave models from a previous
  // run (or the template's demo model) behind: the WPS container serves every
  // .model3 in this folder.
  for (const stale of fs.readdirSync(destFolder)) {
    if (
      path.extname(stale).toLowerCase() === ".model3" &&
      !modelFiles.includes(stale)
    ) {
      fs.rmSync(path.join(destFolder, stale));
      console.info(`Removed stale model: ${stale}`);
    }
  }

  for (const file of modelFiles) {
    const src = path.join(modelsFolder, file);
    const dest = path.join(destFolder, file);
    fs.copyFileSync(src, dest);
    console.info(`Copied model: ${file} → ${dest}`);
  }

  console.info(
    `Finished copying ${modelFiles.length} model(s) to ${destFolder}`
  );
}
