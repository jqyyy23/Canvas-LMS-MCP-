#!/usr/bin/env node
/**
 * canvas-mcp — a read-only MCP server for Canvas LMS.
 *
 * Entry point. stdout is the JSON-RPC channel, so every diagnostic here goes to
 * stderr; a stray console.log would corrupt the protocol stream.
 */

import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { CanvasClient } from './canvas/client.js';
import { ConfigError, loadConfig } from './config.js';
import { registerAllTools } from './tools/index.js';

function main(): void {
    let client: CanvasClient;
    try {
        client = new CanvasClient(loadConfig());
    } catch (err) {
        if (err instanceof ConfigError) {
            // Exit rather than serve: a server with no credentials can only fail
            // every call, and failing at startup is far easier to diagnose.
            console.error(`\n[canvas-mcp] Configuration error:\n\n${err.message}\n`);
            process.exit(1);
        }
        throw err;
    }

    serveStdio(
        () => {
            const server = new McpServer(
                { name: 'canvas-mcp', version: '0.1.0' },
                { capabilities: { tools: {} } },
            );
            registerAllTools(server, client);
            return server;
        },
        {
            onerror: (error) => {
                console.error('[canvas-mcp] transport error:', error.message);
            },
        },
    );

    console.error(`[canvas-mcp] ready — ${client.baseUrl} via ${client.authMode}`);
}

main();
