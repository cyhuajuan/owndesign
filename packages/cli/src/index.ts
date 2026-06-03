import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

type CliOptions = {
  host: string;
  port: number;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3710;
declare const __OWNDESIGN_CLI_VERSION__: string;

async function main(argv: string[]) {
  const options = parseArgs(argv);

  if (options === "help") {
    printHelp();
    return;
  }

  if (options === "version") {
    console.log(__OWNDESIGN_CLI_VERSION__);
    return;
  }

  const cliRoot = path.dirname(fileURLToPath(import.meta.url));
  const staticRoot = path.join(cliRoot, "web");
  const serverEntry = path.join(cliRoot, "server/index.js");
  const child = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      OWNDESIGN_SERVER_HOST: options.host,
      OWNDESIGN_SERVER_PORT: String(options.port),
      OWNDESIGN_WEB_ROOT: staticRoot,
    },
    stdio: "inherit",
  });

  const stop = (signal: NodeJS.Signals) => {
    if (child.exitCode === null) {
      child.kill(signal);
    }
  };

  process.once("SIGINT", () => {
    stop("SIGINT");
  });
  process.once("SIGTERM", () => {
    stop("SIGTERM");
  });

  child.once("exit", (code, signal) => {
    if (signal) {
      process.exit(128 + signalToExitCode(signal));
      return;
    }

    process.exit(code ?? 0);
  });
}

function signalToExitCode(signal: NodeJS.Signals) {
  if (signal === "SIGINT") {
    return 2;
  }

  if (signal === "SIGTERM") {
    return 15;
  }

  return 0;
}

function parseArgs(argv: string[]): CliOptions | "help" | "version" {
  const options: CliOptions = {
    host: process.env.OWNDESIGN_SERVER_HOST ?? DEFAULT_HOST,
    port: Number(process.env.OWNDESIGN_SERVER_PORT ?? DEFAULT_PORT),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      return "help";
    }

    if (arg === "--version" || arg === "-v") {
      return "version";
    }

    if (arg === "--host") {
      options.host = readValue(argv, index, "--host");
      index += 1;
      continue;
    }

    if (arg.startsWith("--host=")) {
      options.host = arg.slice("--host=".length);
      continue;
    }

    if (arg === "--port") {
      options.port = parsePort(readValue(argv, index, "--port"));
      index += 1;
      continue;
    }

    if (arg.startsWith("--port=")) {
      options.port = parsePort(arg.slice("--port=".length));
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error(`Invalid port: ${options.port}`);
  }

  return options;
}

function readValue(argv: string[], index: number, option: string) {
  const value = argv[index + 1];

  if (!value || value.startsWith("-")) {
    throw new Error(`${option} requires a value.`);
  }

  return value;
}

function parsePort(value: string) {
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }

  return port;
}

function printHelp() {
  console.log(`Usage: owndesign [options]

Options:
  --host <host>     Host to bind (default: ${DEFAULT_HOST})
  --port <port>     Port to listen on (default: ${DEFAULT_PORT})
  -h, --help        Show help
  -v, --version     Show version`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Failed to start OwnDesign.");
  process.exit(1);
});
