#!/usr/bin/env node
// The same server as `komadori mcp`, kept as its own command so a config that already uses it keeps working.
// Nothing but JSON-RPC goes to stdout. Needs Chrome, and ffmpeg only if a render asks for a clip.
import { serve } from "../src/mcp-stdio.mjs";

await serve();
process.exit(0);
