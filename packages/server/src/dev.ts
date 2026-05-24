import { startServer } from "./index";

const port = Number(process.env.OWNDESIGN_SERVER_PORT ?? 3711);
const host = process.env.OWNDESIGN_SERVER_HOST ?? "127.0.0.1";

const server = startServer({ host, port });

console.log(`OwnDesign server listening at ${server.url}`);
