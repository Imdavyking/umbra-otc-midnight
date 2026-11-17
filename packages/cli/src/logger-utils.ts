import * as path from "node:path";
import * as fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pino, multistream, type Logger } from "pino";
import { build as pinoPretty } from "pino-pretty";

export const createLogger = async (logPath: string): Promise<Logger> => {
  await fs.mkdir(path.dirname(logPath), { recursive: true });

  const pretty = pinoPretty({
    colorize: true,
    sync: true,
  });

  const level = process.env.DEBUG_LEVEL || "info";

  return pino(
    {
      level,
      depthLimit: 20,
    },
    multistream([
      { stream: pretty, level },
      { stream: createWriteStream(logPath), level },
    ]),
  );
};
