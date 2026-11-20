import { handleProxy } from "./lib/proxy.ts";

// Served at /api/proxy via the /api/* redirect in netlify.toml.
export default async (request: Request): Promise<Response> => handleProxy(request);
