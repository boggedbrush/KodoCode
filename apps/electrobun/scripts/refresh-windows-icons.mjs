import FS from "node:fs";
import Path from "node:path";

import pngToIco from "png-to-ico";

const projectRoot = Path.resolve(import.meta.dirname, "../../..");

const iconPairs = [
  {
    source: Path.join(projectRoot, "assets/prod/kodo-black-universal-1024.png"),
    target: Path.join(projectRoot, "assets/prod/kodo-black-windows.ico"),
  },
  {
    source: Path.join(projectRoot, "assets/dev/blueprint-universal-1024.png"),
    target: Path.join(projectRoot, "assets/dev/blueprint-windows.ico"),
  },
];

for (const pair of iconPairs) {
  if (!FS.existsSync(pair.source)) {
    throw new Error(`Missing source icon PNG: ${pair.source}`);
  }

  const iconBuffer = await pngToIco(pair.source);
  FS.writeFileSync(pair.target, iconBuffer);
  console.log(`refreshed ${Path.relative(projectRoot, pair.target)}`);
}
