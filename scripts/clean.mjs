// Removes the previous build, so files that were deleted from src/ do not linger in dist/.
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

rmSync(join(dirname(fileURLToPath(import.meta.url)), "..", "dist"), { recursive: true, force: true });
