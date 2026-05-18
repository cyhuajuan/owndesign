import { createAddCdnResourceTool } from "./add-cdn-resource";
import { createCreateHtmlTool } from "./create-html";
import { createDeleteTool } from "./delete";
import { createEditTool } from "./edit";
import { createGlobTool } from "./glob";
import { createGrepTool } from "./grep";
import { createPatchTool } from "./patch";
import { createReadTool } from "./read";
import type { ProjectWorkspaceToolContext } from "./types";
import { createWriteTool } from "./write";

export function createProjectWorkspaceTools(
  context: ProjectWorkspaceToolContext,
) {
  return {
    addCdnResource: createAddCdnResourceTool(context),
    createHtml: createCreateHtmlTool(context),
    delete: createDeleteTool(context),
    edit: createEditTool(context),
    glob: createGlobTool(context),
    grep: createGrepTool(context),
    patch: createPatchTool(context),
    read: createReadTool(context),
    write: createWriteTool(context),
  };
}
