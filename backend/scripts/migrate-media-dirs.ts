import fs from "node:fs";
import path from "node:path";
import { scopeToDir } from "../src/domain/media/paths.js";
import type { ContentScope } from "../src/domain/archetypes/schemas.js";

export interface MigrationPlan {
  legacyDir: string;
  sourcePath: string;
  targetScope: ContentScope;
  targetPath: string;
  isAmbiguous: boolean;
  notes?: string;
}

export const LEGACY_MIGRATION_MAPPINGS: Array<{
  legacyDir: string;
  targetScope: ContentScope;
  isAmbiguous: boolean;
  notes?: string;
}> = [
  {
    legacyDir: "mulher",
    targetScope: "single_woman",
    isAmbiguous: false,
  },
  {
    legacyDir: "homem",
    targetScope: "single_man",
    isAmbiguous: false,
  },
  {
    legacyDir: "casal",
    targetScope: "couple_women",
    isAmbiguous: true,
    notes:
      "Legacy 'casal' mapped to default 'couple_women'. If media belongs to couple_men, operator should manually split.",
  },
];

export function computeMediaMigrationPlans(mediaRoot: string): MigrationPlan[] {
  return LEGACY_MIGRATION_MAPPINGS.map((m) => {
    return {
      legacyDir: m.legacyDir,
      sourcePath: path.join(mediaRoot, m.legacyDir),
      targetScope: m.targetScope,
      targetPath: path.join(mediaRoot, m.targetScope),
      isAmbiguous: m.isAmbiguous,
      notes: m.notes,
    };
  });
}

export function executeMediaMigration(
  mediaRoot: string,
  logger: { log: (...args: any[]) => void; warn: (...args: any[]) => void } = console
): { moved: string[]; skipped: string[]; ambiguous: string[] } {
  const plans = computeMediaMigrationPlans(mediaRoot);
  const result = {
    moved: [] as string[],
    skipped: [] as string[],
    ambiguous: [] as string[],
  };

  for (const plan of plans) {
    if (plan.isAmbiguous) {
      result.ambiguous.push(plan.sourcePath);
      logger.warn(
        `[AMBIGUOUS MIGRATION] Legacy directory '${plan.legacyDir}' maps to default '${plan.targetScope}'. ${plan.notes ?? ""}`
      );
    }

    if (!fs.existsSync(plan.sourcePath)) {
      logger.log(`Skipping: source directory does not exist: ${plan.sourcePath}`);
      result.skipped.push(plan.sourcePath);
      continue;
    }

    if (fs.existsSync(plan.targetPath)) {
      // If target exists, move contents into target rather than failing
      logger.log(
        `Target directory already exists: ${plan.targetPath}. Merging contents from ${plan.sourcePath}...`
      );
      mergeDirectoriesSync(plan.sourcePath, plan.targetPath);
      fs.rmSync(plan.sourcePath, { recursive: true, force: true });
      result.moved.push(`${plan.sourcePath} -> ${plan.targetPath}`);
    } else {
      fs.renameSync(plan.sourcePath, plan.targetPath);
      result.moved.push(`${plan.sourcePath} -> ${plan.targetPath}`);
      logger.log(`Moved ${plan.sourcePath} -> ${plan.targetPath}`);
    }
  }

  return result;
}

function mergeDirectoriesSync(srcDir: string, destDir: string) {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      mergeDirectoriesSync(srcPath, destPath);
    } else {
      if (!fs.existsSync(destPath)) {
        fs.renameSync(srcPath, destPath);
      }
    }
  }
}

// CLI entry point when executed directly
if (
  process.argv[1] &&
  (process.argv[1].endsWith("migrate-media-dirs.ts") ||
    process.argv[1].endsWith("migrate-media-dirs.js"))
) {
  const rootDir = process.env.MEDIA_ROOT || path.resolve(process.cwd(), "media");
  console.log(`Starting media directory migration for root: ${rootDir}`);
  const summary = executeMediaMigration(rootDir);
  console.log(`Migration finished:`, summary);
}
