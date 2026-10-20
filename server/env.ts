// Load settings: the app's own .env, then the one in the storage folder
// (where the in-app "Save key" writes when STORAGE_DIR is set, e.g. on a
// hosted server's persistent disk). Real environment variables win.
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ quiet: true });
if (process.env.STORAGE_DIR) dotenv.config({ path: path.join(path.resolve(process.env.STORAGE_DIR), ".env"), quiet: true });
