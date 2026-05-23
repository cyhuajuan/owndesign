import { open, readFile, stat } from "node:fs/promises";

import { isMissingPathError } from "./paths";

export async function readTextFileIfExists(filePath: string) {
  try {
    const fileStats = await stat(filePath);

    if (!fileStats.isFile()) {
      return undefined;
    }

    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) {
      return undefined;
    }

    throw error;
  }
}

export async function readFilePrefix(filePath: string, maxBytes: number) {
  const handle = await open(filePath, "r");

  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);

    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

export function isProbablyBinary(buffer: Buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));

  return sample.includes(0);
}
