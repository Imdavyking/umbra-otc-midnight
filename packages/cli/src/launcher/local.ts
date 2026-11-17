import { createLogger } from "../logger-utils.js";
import { run } from "../index.js";
import { LocalConfig } from "../config.js";

const config = new LocalConfig();
const logger = await createLogger(config.logDir);
await run(config, logger);
