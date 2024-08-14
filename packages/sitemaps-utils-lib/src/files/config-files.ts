import { pathExists, pathExistsSync } from 'fs-extra';
import path from 'path';
import { cwd } from 'process';

/**
 * Filter list of files to only those that exist
 * @param filesToCheck
 * @returns
 */
export async function getExistingFiles(filesToCheck: string[]): Promise<string[]> {
  const existingFiles: string[] = [];
  for (const file of filesToCheck) {
    if (await pathExists(file)) {
      existingFiles.push(file);
    }
  }

  return existingFiles;
}

/**
 * Filter list of files to only those that exist
 * @param filesToCheck
 * @returns
 */
export function getExistingFilesSync(filesToCheck: string[]): string[] {
  const existingFiles: string[] = [];
  for (const file of filesToCheck) {
    if (pathExistsSync(file)) {
      existingFiles.push(file);
    }
  }

  return existingFiles;
}

export type EnvLevels = string;
export function getEnvLevel(): EnvLevels | undefined {
  const nodeConfigEnv = process.env.NODE_CONFIG_ENV;

  if (nodeConfigEnv === undefined) {
    return;
  }

  // Throw if env is not of an expected pattern that works well with filenames
  if (/[^a-zA-Z0-9\-_]/.test(nodeConfigEnv)) {
    throw new Error(
      `NODE_CONFIG_ENV must only contain letters, numbers, hyphens, and underscores: ${nodeConfigEnv}`,
    );
  }

  return nodeConfigEnv;
}

/**
 * Find which config files exist using the config file base names
 * and yaml, yml, or json extensions @ the specific paths.
 *
 * Filters out files that do not exist as `convict` throws when passed
 * files that do not exist.
 *
 * `-${NODE_CONFIG_ENV} is optionally appended to each file root name.
 * @returns
 */
export function getConfigFiles(
  opts: {
    fileBaseNames?: string[];
    paths?: string[];
    checkEnvOverrides?: boolean;
  } = {},
): string[] {
  const {
    fileBaseNames = ['config'],
    paths = [
      cwd(),
      path.join(cwd(), '..'),
      path.join(cwd(), '..', 'configs'),
      path.join(cwd(), 'configs'),
      '/opt',
      '/opt/configs',
    ],
    checkEnvOverrides = true,
  } = opts;
  const env = getEnvLevel();
  const filesToCheck: string[] = [];

  // Add the extensions
  for (const fileBase of fileBaseNames) {
    if (fileBase.includes('.yml') || fileBase.includes('.yaml') || fileBase.includes('.json')) {
      throw new TypeError(
        'fileBaseNames must not have extensions as they are added by getConfigFiles',
      );
    }

    filesToCheck.push(`${fileBase}.yml`);
    filesToCheck.push(`${fileBase}.yaml`);
    filesToCheck.push(`${fileBase}.json`);
    if (checkEnvOverrides && !!env) {
      filesToCheck.push(`${fileBase}-${env}.yml`);
      filesToCheck.push(`${fileBase}-${env}.yaml`);
      filesToCheck.push(`${fileBase}-${env}.json`);
    }
  }

  const possibleFiles: string[] = [];
  for (const pathRoot of paths) {
    for (const file of filesToCheck) {
      possibleFiles.push(path.join(pathRoot, file));
    }
  }
  return getExistingFilesSync(possibleFiles);
}
