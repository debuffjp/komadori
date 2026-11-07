# komadori-mcp

The [komadori](https://github.com/debuffjp/komadori) MCP server: `render`, `look` and `diff` for browser scenes, as tools an agent can call. All the code is in the `komadori` package; this one depends on it so that this works:

```json
{ "mcpServers": { "komadori": { "command": "npx", "args": ["-y", "komadori-mcp"] } } }
```

Needs Chrome, and ffmpeg only if a render asks for a clip. See the [komadori README](https://github.com/debuffjp/komadori#for-agents-an-mcp-server) for what the tools do.
