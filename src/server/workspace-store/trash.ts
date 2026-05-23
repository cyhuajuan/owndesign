import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";

import trash from "trash";

const execFileAsync = promisify(execFile);

export async function movePathToTrash(
  targetPath: string,
  options: {
    platform: NodeJS.Platform;
    runWindowsRecycleCommand: (targetPath: string) => Promise<void>;
  },
) {
  if (options.platform === "win32") {
    await options.runWindowsRecycleCommand(targetPath);
    return;
  }

  await trash([targetPath], { glob: false });
}

export async function runWindowsRecycleCommand(targetPath: string) {
  const recycleScript = `
$targetPath = [Environment]::GetEnvironmentVariable('OWNDESIGN_TRASH_TARGET')
Add-Type -AssemblyName Microsoft.VisualBasic
$item = Get-Item -LiteralPath $targetPath -Force
if ($item.PSIsContainer) {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($item.FullName, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
} else {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($item.FullName, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
}
`;

  await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      recycleScript,
    ],
    {
      env: {
        ...process.env,
        OWNDESIGN_TRASH_TARGET: targetPath,
      },
      windowsHide: true,
    },
  );
}
