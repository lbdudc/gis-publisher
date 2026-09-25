import fs from "fs";
import path from "path";
import { brandingFromManifest } from "./options-util.js";

// Where the plugin stages the logo (`<staged folder>/branding/<logo>`), and where the
// generated client serves it from (`client/public/img/branding/`)
export const BRANDING_DIR = "branding";
const CLIENT_LOGO_DIR = path.join("client", "public", "img", "branding");
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/**
 * Whether the manifest's logo exists in the staged folder and is usable and, when
 * `outputDir` is given, copies it into the generated client (replacing the logos of
 * an earlier run). A logo that is missing or too big is skipped with a warning: the
 * app just shows no logo.
 */
export function stageBrandingLogo(stagedRoot, manifest, outputDir = null) {
  const logo = brandingFromManifest(manifest).logo;
  if (!logo) return false;

  const source = path.join(stagedRoot, BRANDING_DIR, logo);
  let stat;
  try {
    stat = fs.statSync(source);
  } catch {
    console.warn(`Ignoring the logo: ${source} was not found.`);
    return false;
  }
  if (!stat.isFile() || stat.size > MAX_LOGO_BYTES) {
    console.warn(
      `Ignoring the logo ${logo}: it must be a file of at most ${
        MAX_LOGO_BYTES / 1024 / 1024
      } MB.`
    );
    return false;
  }

  if (outputDir) {
    const target = path.join(outputDir, CLIENT_LOGO_DIR);
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    fs.copyFileSync(source, path.join(target, logo));
  }
  return true;
}
