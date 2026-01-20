import fs from "fs";
import path from "path";

// Retrieves all charts from a folder and returns them as an array of objects { name, spec }
export function getChartsFromJson(chartsFolder) {
  if (!fs.existsSync(chartsFolder)) {
    console.warn(`The charts folder "${chartsFolder}" does not exist`);
    return [];
  }

  const files = fs.readdirSync(chartsFolder);
  const charts = [];

  for (const file of files) {
    const ext = path.extname(file);
    if (ext.toLowerCase() !== ".json") continue;

    const chartName = path.basename(file, ".json");
    const chartPath = path.join(chartsFolder, file);

    try {
      const spec = JSON.parse(fs.readFileSync(chartPath, "utf-8"));
      charts.push({ name: chartName, spec });
    } catch (e) {
      console.error(`Error parsing the chart "${file}":`, e);
    }
  }

  return charts;
}
