import { describe, expect, it } from "vitest";

import {
  appendBrowsePathSegment,
  canNavigateUp,
  ensureBrowseDirectoryPath,
  findProjectByPath,
  getBrowseParentPath,
  inferProjectTitleFromPath,
  isFilesystemBrowseQuery,
  normalizeProjectPathForDispatch,
  resolveProjectPathForDispatch,
} from "./projectPaths";

describe("projectPaths", () => {
  it("normalizes paths for dispatch", () => {
    expect(normalizeProjectPathForDispatch("/tmp/project/")).toBe("/tmp/project");
    expect(normalizeProjectPathForDispatch("C:\\repo\\")).toBe("C:\\repo");
  });

  it("resolves explicit relative paths against an absolute cwd", () => {
    expect(resolveProjectPathForDispatch("./child", "/tmp/project")).toBe("/tmp/project/child");
    expect(resolveProjectPathForDispatch("../sibling", "/tmp/project")).toBe("/tmp/sibling");
  });

  it("detects browse-like queries", () => {
    expect(isFilesystemBrowseQuery("~/code")).toBe(true);
    expect(isFilesystemBrowseQuery("/tmp")).toBe(true);
    expect(isFilesystemBrowseQuery("repo")).toBe(false);
    expect(isFilesystemBrowseQuery("C:\\repo", "Win32")).toBe(true);
  });

  it("matches projects by normalized cwd", () => {
    const project = { cwd: "/tmp/project" };
    expect(findProjectByPath([project], "/tmp/project/")).toBe(project);
  });

  it("infers a title from the leaf path segment", () => {
    expect(inferProjectTitleFromPath("/tmp/project")).toBe("project");
    expect(inferProjectTitleFromPath("C:\\Users\\cj\\repo")).toBe("repo");
  });

  it("supports browse navigation helpers", () => {
    expect(ensureBrowseDirectoryPath("/tmp/project")).toBe("/tmp/project/");
    expect(appendBrowsePathSegment("/tmp/project/", "src")).toBe("/tmp/project/src/");
    expect(getBrowseParentPath("/tmp/project/src/")).toBe("/tmp/project/");
    expect(canNavigateUp("/tmp/project/src/")).toBe(true);
    expect(getBrowseParentPath("/")).toBeNull();
  });
});
