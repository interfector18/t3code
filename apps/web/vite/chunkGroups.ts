export const iconChunkGroup = {
  name: "icons",
  // Icon initialization reads media constants before a cyclic utilities chunk can run.
  test: /\/@pierre\/trees\/|\/(?:components\/chat\/PierreEntryIcon\.tsx|pierre-icons\.ts|(?:mediaPreview|video|image)\.ts)$/,
  includeDependenciesRecursively: false,
};
