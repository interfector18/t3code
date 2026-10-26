// @effect-diagnostics nodeBuiltinImport:off - Builds and executes isolated production chunks on disk.
import { assert, describe, it } from "vite-plus/test";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import { build } from "vite-plus";
import { iconChunkGroup } from "../vite/chunkGroups";

import {
  hasSpecificPierreIconForFileName,
  resolvePierreIconForEntry,
  T3_PIERRE_ICONS,
} from "./pierre-icons";

it("initializes video icons when production utilities import the icon chunk", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-icon-chunks-"));
  const video = NodeURL.fileURLToPath(
    new URL("../../../packages/shared/src/video.ts", import.meta.url),
  );
  const icons = NodeURL.fileURLToPath(new URL("./pierre-icons.ts", import.meta.url));
  try {
    await NodeFSP.writeFile(
      NodePath.join(root, "utils.ts"),
      `
export { VIDEO_FILE_EXTENSIONS } from ${JSON.stringify(video)};
export { T3_PIERRE_ICONS } from ${JSON.stringify(icons)};
`,
    );
    await NodeFSP.writeFile(
      NodePath.join(root, "main.ts"),
      `
import { VIDEO_FILE_EXTENSIONS, T3_PIERRE_ICONS } from './utils.ts';
for (const extension of VIDEO_FILE_EXTENSIONS) {
  if (T3_PIERRE_ICONS.byFileExtension[extension] !== 't3-file-icon-video') throw new Error(extension);
}
console.log('Video icons initialized.');
`,
    );
    await build({
      configFile: false,
      root,
      logLevel: "silent",
      build: {
        minify: true,
        rolldownOptions: {
          input: NodePath.join(root, "main.ts"),
          output: {
            entryFileNames: "main.mjs",
            chunkFileNames: "[name]-[hash].mjs",
            codeSplitting: {
              groups: [
                { ...iconChunkGroup, priority: 10 },
                {
                  name: "utils",
                  test: /\/(?:utils|video|image)\.ts$/,
                  includeDependenciesRecursively: false,
                },
              ],
            },
          },
        },
      },
    });
    const result = await NodeUtil.promisify(NodeChildProcess.execFile)("node", [
      NodePath.join(root, "dist/main.mjs"),
    ]);
    assert.include(result.stdout, "Video icons initialized.");
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

describe("Pierre file icons", () => {
  it.each(["photo.heic", "photo.heif", "PHOTO.HEIC", "folder/photo.HEIF"])(
    "uses the image icon for %s",
    (name) => {
      assert.equal(resolvePierreIconForEntry(name, "file")?.token, "image");
      assert.isTrue(hasSpecificPierreIconForFileName(name));
    },
  );
  it("uses detected types for extensionless files while keeping known filename icons", () => {
    assert.equal(
      resolvePierreIconForEntry("custom-script", "file", "text/x-python")?.token,
      "python",
    );
    assert.equal(resolvePierreIconForEntry("image", "file", "image/png")?.token, "image");
    assert.equal(
      resolvePierreIconForEntry("Dockerfile", "file", "text/x-shellscript")?.token,
      "docker",
    );
    assert.isNull(resolvePierreIconForEntry("folder.png", "directory", "image/png"));
    assert.equal(
      resolvePierreIconForEntry("unknown", "file", "application/octet-stream")?.token,
      "default",
    );
  });

  it.each([
    ["pdf", "pdf"],
    ["doc", "word"],
    ["docx", "word"],
    ["odt", "word"],
    ["rtf", "word"],
    ["xls", "spreadsheet"],
    ["xlsx", "spreadsheet"],
    ["ods", "spreadsheet"],
    ["csv", "spreadsheet"],
    ["tsv", "spreadsheet"],
    ["ppt", "slides"],
    ["pptx", "slides"],
    ["odp", "slides"],
    ["epub", "epub"],
  ])("uses the document family icon for %s", (extension, family) => {
    for (const path of [`report.${extension}`, `folder/REPORT.${extension.toUpperCase()}`]) {
      assert.equal(resolvePierreIconForEntry(path, "file")?.name, `t3-file-icon-${family}`);
      assert.isTrue(hasSpecificPierreIconForFileName(path));
    }
  });

  it("ships every custom icon referenced by the extended resolver", () => {
    const customIconNames = new Set(
      [
        ...Object.values(T3_PIERRE_ICONS.byFileName),
        ...Object.values(T3_PIERRE_ICONS.byFileExtension),
      ].filter((name) => name.startsWith("t3-")),
    );
    for (const iconName of customIconNames) {
      assert.include(T3_PIERRE_ICONS.spriteSheet, `id="${iconName}"`);
    }
  });
});
