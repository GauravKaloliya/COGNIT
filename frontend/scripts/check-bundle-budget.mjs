import fs from "fs";
import path from "path";

const distDir = path.resolve(process.cwd(), "dist/assets");
if (!fs.existsSync(distDir)) {
  console.error("dist/assets not found. Run npm run build first.");
  process.exit(1);
}

const files = fs.readdirSync(distDir).map((f) => path.join(distDir, f));
const jsFiles = files.filter((f) => f.endsWith(".js"));
const cssFiles = files.filter((f) => f.endsWith(".css"));

const maxMainJs = 200 * 1024;
const maxVendorJs = 260 * 1024;
const maxCss = 90 * 1024;

let hasError = false;

for (const file of jsFiles) {
  const size = fs.statSync(file).size;
  const base = path.basename(file);
  if (base.startsWith("index-") && size > maxMainJs) {
    console.error(`Budget exceeded: ${base} ${size} > ${maxMainJs}`);
    hasError = true;
  }
  if (base.startsWith("vendor-") && size > maxVendorJs) {
    console.error(`Budget exceeded: ${base} ${size} > ${maxVendorJs}`);
    hasError = true;
  }
}

for (const file of cssFiles) {
  const size = fs.statSync(file).size;
  const base = path.basename(file);
  if (size > maxCss) {
    console.error(`Budget exceeded: ${base} ${size} > ${maxCss}`);
    hasError = true;
  }
}

if (hasError) {
  process.exit(1);
}

console.log("Bundle budget checks passed.");
