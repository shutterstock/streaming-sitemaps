// fs-extra is commonjs so we have to import it this way
import fsExtra from 'fs-extra';

export function getUrlOrFilePath(
  input: string,
): { url: URL; file?: never } | { url?: never; file: string } {
  try {
    const url = new URL(input);
    return { url };
  } catch {
    if (!fsExtra.existsSync(input)) {
      throw new Error(`ENOTFOUND: ${input} is not a valid`);
    }
    return { file: input };
  }
}
