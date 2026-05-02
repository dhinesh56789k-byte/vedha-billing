const fs = require("fs");
const path = require("path");

const source = path.join(__dirname, "..", "frontend", "dist");
const target = path.join(__dirname, "frontend-dist");

if (!fs.existsSync(source)) {
  console.error("Missing frontend build. Run npm run build:frontend from the project root first.");
  process.exit(1);
}

fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });
console.log("Copied frontend build into electron/frontend-dist");
