import {
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WorkspaceStore } from "@owndesign/core/workspace-store";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (tempRoot) => {
      await rm(tempRoot, { force: true, recursive: true });
    }),
  );
});

async function createTempWorkspaceRoot() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "owndesign-workspace-store-"));
  tempRoots.push(tempRoot);
  return tempRoot;
}

function buildProject(overrides: Partial<{
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}> = {}) {
  return {
    id: overrides.id ?? "project-alpha",
    name: overrides.name ?? "Project Alpha",
    description: overrides.description,
    outputType: "html" as const,
    createdAt: overrides.createdAt ?? "2026-05-14T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-05-14T10:00:00.000Z",
  };
}

describe("WorkspaceStore", () => {
  it("creates the Workspace lazily when first Project is persisted", async () => {
    const workspaceRoot = path.join(await createTempWorkspaceRoot(), ".owndesign");
    const store = new WorkspaceStore({ workspaceRoot });

    await expect(stat(workspaceRoot)).rejects.toThrow();

    await store.createProject(buildProject());

    await expect(stat(workspaceRoot)).resolves.toBeDefined();
    await expect(stat(path.join(workspaceRoot, "projects"))).resolves.toBeDefined();
  });

  it("persists each Project in its own Project Directory with project metadata and workspace directory", async () => {
    const workspaceRoot = path.join(await createTempWorkspaceRoot(), ".owndesign");
    const store = new WorkspaceStore({ workspaceRoot });
    const project = buildProject({ id: "project-bravo", name: "Project Bravo" });

    await store.createProject(project);

    const projectDirectory = path.join(workspaceRoot, "projects", project.id);
    const projectJson = JSON.parse(
      await readFile(path.join(projectDirectory, "project.json"), "utf8"),
    );

    await expect(stat(projectDirectory)).resolves.toBeDefined();
    await expect(stat(path.join(projectDirectory, "workspace"))).resolves.toBeDefined();
    expect(projectJson).toEqual(project);
  });

  it("writes and reads Project Output from the Project Workspace", async () => {
    const workspaceRoot = path.join(await createTempWorkspaceRoot(), ".owndesign");
    const store = new WorkspaceStore({ workspaceRoot });
    const project = buildProject({ id: "project-output" });
    const html = "<!doctype html><html><body>Preview</body></html>";

    await store.createProject(project);
    const outputPath = await store.writeProjectOutput(project.id, "html", html);

    expect(outputPath).toBe(
      path.join(workspaceRoot, "projects", project.id, "workspace", "index.html"),
    );
    await expect(store.readProjectOutput(project.id, "html")).resolves.toBe(html);
  });

  it("lists nested Project Workspace files and directories recursively", async () => {
    const workspaceRoot = path.join(await createTempWorkspaceRoot(), ".owndesign");
    const store = new WorkspaceStore({ workspaceRoot });
    const project = buildProject({ id: "project-files" });

    await store.createProject(project);
    await store.writeProjectWorkspaceFile(project.id, "index.html", "<main>Hello</main>");
    await store.writeProjectWorkspaceFile(project.id, "assets/app.js", "console.log(1);");

    const entries = await store.listProjectWorkspace(project.id);

    expect(entries.map((entry) => [entry.path, entry.type])).toEqual([
      ["assets", "directory"],
      ["assets/app.js", "file"],
      ["index.html", "file"],
    ]);
    expect(entries.every((entry) => typeof entry.size === "number")).toBe(true);
    expect(entries.every((entry) => typeof entry.updatedAt === "string")).toBe(true);
  });

  it("lists HTML files recursively with index first", async () => {
    const workspaceRoot = path.join(await createTempWorkspaceRoot(), ".owndesign");
    const store = new WorkspaceStore({ workspaceRoot });
    const project = buildProject({ id: "project-html-files" });

    await store.createProject(project);
    await store.writeProjectWorkspaceFile(project.id, "dashboard.html", "<main />");
    await store.writeProjectWorkspaceFile(project.id, "index.html", "<main />");
    await store.writeProjectWorkspaceFile(project.id, "pages/detail.HTML", "<main />");
    await store.writeProjectWorkspaceFile(project.id, "assets/app.js", "");

    await expect(store.listProjectHtmlFiles(project.id)).resolves.toEqual([
      "index.html",
      "dashboard.html",
      "pages/detail.HTML",
    ]);
  });

  it("searches Project Workspace text files with line previews", async () => {
    const workspaceRoot = path.join(await createTempWorkspaceRoot(), ".owndesign");
    const store = new WorkspaceStore({ workspaceRoot });
    const project = buildProject({ id: "project-search" });

    await store.createProject(project);
    await store.writeProjectWorkspaceFile(
      project.id,
      "index.html",
      "<main>\n  <h1>CRM Dashboard</h1>\n</main>",
    );
    await store.writeProjectWorkspaceFile(project.id, "notes.md", "No match");

    await expect(
      store.searchProjectWorkspace(project.id, "Dashboard"),
    ).resolves.toEqual({
      matches: [
        {
          line: 2,
          path: "index.html",
          preview: "<h1>CRM Dashboard</h1>",
        },
      ],
      skippedFiles: [],
      totalMatches: 1,
      truncated: false,
    });
  });

  it("reads Project Workspace files with line windows and directories with entry windows", async () => {
    const workspaceRoot = path.join(await createTempWorkspaceRoot(), ".owndesign");
    const store = new WorkspaceStore({ workspaceRoot });
    const project = buildProject({ id: "project-read-entry" });

    await store.createProject(project);
    await store.writeProjectWorkspaceFile(
      project.id,
      "index.html",
      "<main>\n  <h1>CRM Dashboard</h1>\n</main>",
    );
    await store.writeProjectWorkspaceFile(project.id, "assets/app.css", "body {}");

    await expect(
      store.readProjectWorkspaceEntry(project.id, "index.html", {
        limit: 1,
        offset: 2,
      }),
    ).resolves.toMatchObject({
      content: "2:   <h1>CRM Dashboard</h1>",
      path: "index.html",
      startLine: 2,
      type: "file",
    });
    await expect(
      store.readProjectWorkspaceEntry(project.id, ".", {
        limit: 1,
      }),
    ).resolves.toMatchObject({
      entries: [
        {
          path: "assets",
          type: "directory",
        },
      ],
      totalEntries: 2,
      truncated: true,
      type: "directory",
    });
  });

  it("matches Project Workspace paths with glob patterns", async () => {
    const workspaceRoot = path.join(await createTempWorkspaceRoot(), ".owndesign");
    const store = new WorkspaceStore({ workspaceRoot });
    const project = buildProject({ id: "project-glob" });

    await store.createProject(project);
    await store.writeProjectWorkspaceFile(project.id, "index.html", "<main></main>");
    await store.writeProjectWorkspaceFile(project.id, "assets/app.css", "body {}");
    await store.writeProjectWorkspaceFile(project.id, "assets/app.js", "console.log(1);");

    await expect(
      store.globProjectWorkspace(project.id, "**/*.{css,js}"),
    ).resolves.toMatchObject({
      matches: expect.arrayContaining([
        expect.objectContaining({ path: "assets/app.css", type: "file" }),
        expect.objectContaining({ path: "assets/app.js", type: "file" }),
      ]),
      totalMatches: 2,
      truncated: false,
    });
  });

  it("greps Project Workspace text files with regex and include filters", async () => {
    const workspaceRoot = path.join(await createTempWorkspaceRoot(), ".owndesign");
    const store = new WorkspaceStore({ workspaceRoot });
    const project = buildProject({ id: "project-grep" });

    await store.createProject(project);
    await store.writeProjectWorkspaceFile(
      project.id,
      "index.html",
      "<main>\n  <h1>CRM Dashboard</h1>\n</main>",
    );
    await store.writeProjectWorkspaceFile(project.id, "notes.md", "CRM Dashboard");

    await expect(
      store.grepProjectWorkspace(project.id, "CRM\\s+Dashboard", {
        include: "*.html",
      }),
    ).resolves.toEqual({
      matches: [
        {
          line: 2,
          path: "index.html",
          preview: "<h1>CRM Dashboard</h1>",
        },
      ],
      skippedFiles: [],
      totalMatches: 1,
      truncated: false,
    });
  });

  it("reads, writes, edits, and deletes Project Workspace paths", async () => {
    const workspaceRoot = path.join(await createTempWorkspaceRoot(), ".owndesign");
    const store = new WorkspaceStore({ workspaceRoot });
    const project = buildProject({ id: "project-edit" });

    await store.createProject(project);
    await expect(
      store.writeProjectWorkspaceFile(project.id, "pages/home.html", "Hello world"),
    ).resolves.toMatchObject({
      bytesWritten: 11,
      diff: expect.stringContaining("+Hello world"),
      path: "pages/home.html",
    });
    await expect(
      store.readProjectWorkspaceFile(project.id, "pages/home.html"),
    ).resolves.toBe("Hello world");
    await expect(
      store.editProjectWorkspaceFile(
        project.id,
        "pages/home.html",
        "Hello",
        "Design",
      ),
    ).resolves.toMatchObject({
      diff: expect.stringContaining("+Design world"),
      path: "pages/home.html",
      replacements: 1,
    });
    await expect(
      store.readProjectWorkspaceFile(project.id, "pages/home.html"),
    ).resolves.toBe("Design world");
    await expect(
      store.deleteProjectWorkspacePath(project.id, "pages"),
    ).resolves.toEqual({
      deleted: true,
      path: "pages",
    });
    await expect(
      store.readProjectWorkspaceFile(project.id, "pages/home.html"),
    ).rejects.toThrow();
  });

  it("applies Project Workspace patch changes", async () => {
    const workspaceRoot = path.join(await createTempWorkspaceRoot(), ".owndesign");
    const store = new WorkspaceStore({ workspaceRoot });
    const project = buildProject({ id: "project-patch" });

    await store.createProject(project);
    await store.writeProjectWorkspaceFile(project.id, "index.html", "<main>Old</main>");
    await store.writeProjectWorkspaceFile(project.id, "remove.txt", "bye");

    await expect(
      store.applyProjectWorkspacePatch(project.id, [
        {
          newString: "New",
          oldString: "Old",
          operation: "edit",
          path: "index.html",
        },
        {
          content: "body {}",
          operation: "add",
          path: "assets/app.css",
        },
        {
          operation: "delete",
          path: "remove.txt",
        },
      ]),
    ).resolves.toMatchObject({ changed: 3 });
    await expect(
      store.readProjectWorkspaceFile(project.id, "index.html"),
    ).resolves.toBe("<main>New</main>");
    await expect(
      store.readProjectWorkspaceFile(project.id, "assets/app.css"),
    ).resolves.toBe("body {}");
    await expect(
      store.readProjectWorkspaceFile(project.id, "remove.txt"),
    ).rejects.toThrow();
  });

  it("does not partially apply Project Workspace patch changes when validation fails", async () => {
    const workspaceRoot = path.join(await createTempWorkspaceRoot(), ".owndesign");
    const store = new WorkspaceStore({ workspaceRoot });
    const project = buildProject({ id: "project-atomic-patch" });

    await store.createProject(project);
    await store.writeProjectWorkspaceFile(project.id, "index.html", "<main>Old</main>");

    await expect(
      store.applyProjectWorkspacePatch(project.id, [
        {
          content: "created",
          operation: "write",
          path: "created.txt",
        },
        {
          newString: "New",
          oldString: "Missing",
          operation: "edit",
          path: "index.html",
        },
      ]),
    ).rejects.toThrow("oldText was not found");
    await expect(
      store.readProjectWorkspaceFile(project.id, "created.txt"),
    ).rejects.toThrow();
    await expect(
      store.readProjectWorkspaceFile(project.id, "index.html"),
    ).resolves.toBe("<main>Old</main>");
  });

  it("rejects missing and non-unique exact edit targets", async () => {
    const workspaceRoot = path.join(await createTempWorkspaceRoot(), ".owndesign");
    const store = new WorkspaceStore({ workspaceRoot });
    const project = buildProject({ id: "project-edit-errors" });

    await store.createProject(project);
    await store.writeProjectWorkspaceFile(project.id, "index.html", "button button");

    await expect(
      store.editProjectWorkspaceFile(project.id, "index.html", "missing", "link"),
    ).rejects.toThrow("oldText was not found");
    await expect(
      store.editProjectWorkspaceFile(project.id, "index.html", "button", "link"),
    ).rejects.toThrow("oldText appears more than once");
  });

  it("returns truncation and skipped-file metadata for large reads and greps", async () => {
    const workspaceRoot = path.join(await createTempWorkspaceRoot(), ".owndesign");
    const store = new WorkspaceStore({ workspaceRoot });
    const project = buildProject({ id: "project-tool-bounds" });
    const longLine = `${"a".repeat(2500)}TAIL`;

    await store.createProject(project);
    await store.writeProjectWorkspaceFile(project.id, "long.html", longLine);
    await store.writeProjectWorkspaceFile(
      project.id,
      "huge.txt",
      "Dashboard\n".repeat(130_000),
    );
    await writeFile(
      path.join(
        workspaceRoot,
        "projects",
        project.id,
        "workspace",
        "binary.bin",
      ),
      Buffer.from([0, 1, 2, 3]),
    );

    await expect(
      store.readProjectWorkspaceEntry(project.id, "long.html"),
    ).resolves.toMatchObject({
      content: expect.stringContaining("<truncated>"),
      truncated: true,
      truncatedReason: "line-length",
    });
    await expect(
      store.grepProjectWorkspace(project.id, "Dashboard"),
    ).resolves.toMatchObject({
      matches: [],
      skippedFiles: expect.arrayContaining([
        expect.objectContaining({ path: "binary.bin", reason: "binary" }),
        expect.objectContaining({ path: "huge.txt", reason: "too-large" }),
      ]),
      totalMatches: 0,
      truncated: false,
    });
  });

  it("rejects unsafe Project Workspace paths", async () => {
    const workspaceRoot = path.join(await createTempWorkspaceRoot(), ".owndesign");
    const store = new WorkspaceStore({ workspaceRoot });
    const project = buildProject({ id: "project-unsafe-path" });

    await store.createProject(project);

    await expect(
      store.writeProjectWorkspaceFile(project.id, "../escape.html", "bad"),
    ).rejects.toThrow("escapes workspace");
    await expect(
      store.readProjectWorkspaceFile(project.id, path.join(workspaceRoot, "x.html")),
    ).rejects.toThrow("must be relative");
    await expect(
      store.readProjectWorkspaceFileBuffer(project.id, "../escape.html"),
    ).rejects.toThrow("escapes workspace");
    await expect(
      store.deleteProjectWorkspacePath(project.id, ""),
    ).rejects.toThrow("must not be empty");
  });

  it("rejects symlink access in the Project Workspace", async () => {
    const tempRoot = await createTempWorkspaceRoot();
    const workspaceRoot = path.join(tempRoot, ".owndesign");
    const outsideRoot = path.join(tempRoot, "outside");
    const store = new WorkspaceStore({ workspaceRoot });
    const project = buildProject({ id: "project-symlink" });

    await store.createProject(project);
    await mkdir(outsideRoot, { recursive: true });
    await writeFile(path.join(outsideRoot, "secret.txt"), "secret", "utf8");

    try {
      await symlink(
        path.join(outsideRoot, "secret.txt"),
        path.join(
          workspaceRoot,
          "projects",
          project.id,
          "workspace",
          "secret-link.txt",
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        return;
      }

      throw error;
    }

    await expect(
      store.readProjectWorkspaceFile(project.id, "secret-link.txt"),
    ).rejects.toThrow("symlinks are not supported");
    await expect(
      store.readProjectWorkspaceFileBuffer(project.id, "secret-link.txt"),
    ).rejects.toThrow("symlinks are not supported");
  });

  it("reads Project Workspace files as buffers", async () => {
    const workspaceRoot = path.join(await createTempWorkspaceRoot(), ".owndesign");
    const store = new WorkspaceStore({ workspaceRoot });
    const project = buildProject({ id: "project-buffer-read" });

    await store.createProject(project);
    await store.writeProjectWorkspaceFile(project.id, "index.html", "<main>Buffer</main>");

    await expect(
      store.readProjectWorkspaceFileBuffer(project.id, "index.html"),
    ).resolves.toEqual(Buffer.from("<main>Buffer</main>"));
  });

  it("discovers persisted Projects after reload and returns them in Project Updated Time descending order", async () => {
    const workspaceRoot = path.join(await createTempWorkspaceRoot(), ".owndesign");
    const firstStore = new WorkspaceStore({ workspaceRoot });

    await firstStore.createProject(
      buildProject({
        id: "project-older",
        name: "Older Project",
        updatedAt: "2026-05-14T09:00:00.000Z",
      }),
    );
    await firstStore.createProject(
      buildProject({
        id: "project-newer",
        name: "Newer Project",
        updatedAt: "2026-05-14T11:00:00.000Z",
      }),
    );

    const secondStore = new WorkspaceStore({ workspaceRoot });

    await expect(secondStore.listProjects()).resolves.toEqual([
      buildProject({
        id: "project-newer",
        name: "Newer Project",
        updatedAt: "2026-05-14T11:00:00.000Z",
      }),
      buildProject({
        id: "project-older",
        name: "Older Project",
        updatedAt: "2026-05-14T09:00:00.000Z",
      }),
    ]);
  });

  it("moves a Project Directory to the recycle bin adapter instead of deleting it directly", async () => {
    const workspaceRoot = path.join(await createTempWorkspaceRoot(), ".owndesign");
    const recycleBinRoot = path.join(await createTempWorkspaceRoot(), "recycle-bin");
    const movedPaths: string[] = [];
    const store = new WorkspaceStore({
      workspaceRoot,
      moveToTrash: async (targetPath) => {
        movedPaths.push(targetPath);
        await mkdir(recycleBinRoot, { recursive: true });
        await rename(targetPath, path.join(recycleBinRoot, path.basename(targetPath)));
      },
    });
    const project = buildProject({ id: "project-delete-me" });

    await store.createProject(project);
    await store.deleteProject(project.id);

    expect(movedPaths).toEqual([path.join(workspaceRoot, "projects", project.id)]);
    await expect(stat(path.join(workspaceRoot, "projects", project.id))).rejects.toThrow();
    await expect(
      stat(path.join(recycleBinRoot, project.id, "project.json")),
    ).resolves.toBeDefined();
  });

  it("uses the Windows recycle command instead of the trash package on Windows", async () => {
    const workspaceRoot = path.join(await createTempWorkspaceRoot(), ".owndesign");
    const recycleBinRoot = path.join(await createTempWorkspaceRoot(), "recycle-bin");
    const recycledPaths: string[] = [];
    const store = new WorkspaceStore({
      workspaceRoot,
      platform: "win32",
      runWindowsRecycleCommand: async (targetPath) => {
        recycledPaths.push(targetPath);
        await mkdir(recycleBinRoot, { recursive: true });
        await rename(targetPath, path.join(recycleBinRoot, path.basename(targetPath)));
      },
    });
    const project = buildProject({ id: "project-windows-delete" });

    await store.createProject(project);
    await store.deleteProject(project.id);

    expect(recycledPaths).toEqual([path.join(workspaceRoot, "projects", project.id)]);
    await expect(
      stat(path.join(recycleBinRoot, project.id, "project.json")),
    ).resolves.toBeDefined();
  });
});
