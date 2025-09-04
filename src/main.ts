/**
 * Serves as an Actor MCP SSE server entry point.
 * This file needs to be named `main.ts` to be recognized by the Apify platform.
 */

import { Actor } from 'apify';
import type { ActorCallOptions } from 'apify-client';

import log from '@apify/log';

import { createExpressApp } from './actor/server.js';
import { processInput } from './input.js';
import { callActorGetDataset } from './tools/index.js';
import type { Input } from './types.js';

const STANDBY_MODE = Actor.getEnv().metaOrigin === 'STANDBY';

await Actor.init();

const HOST = Actor.isAtHome() ? process.env.ACTOR_STANDBY_URL as string : '0.0.0.0';
const PORT = Actor.isAtHome() ? Number(process.env.ACTOR_STANDBY_PORT) : (process.env.PORT ? Number(process.env.PORT) : 3001);

if (!process.env.APIFY_TOKEN) {
    log.error('APIFY_TOKEN is required but not set in the environment variables.');
    process.exit(1);
}

const input = processInput((await Actor.getInput<Partial<Input>>()) ?? ({} as Input));
log.info('Loaded input', { input: JSON.stringify(input) });

if (STANDBY_MODE) {
    let actorsToLoad: string[] = [];
    // TODO: in standby mode the input loading does not actually work,
    // we should remove this since we are using the URL query parameters to load Actors
    // Load only Actors specified in the input
    // If you wish to start without any Actor, create a task and leave the input empty
    if (input.actors && input.actors.length > 0) {
        const { actors } = input;
        actorsToLoad = Array.isArray(actors) ? actors : actors.split(',');
    }
    // Include Actors to load in the MCP server options for backwards compatibility
    const app = createExpressApp(HOST, {
        enableAddingActors: Boolean(input.enableAddingActors),
        enableDefaultActors: false,
        actors: actorsToLoad,
    });
    log.info('Actor is running in the STANDBY mode.');

    app.listen(PORT, () => {
        log.info('Actor web server listening', { host: HOST, port: PORT });
    });
} else {
    // Check if we have debugActor - if so, run in debug mode
    if (input.debugActor && input.debugActorInput) {
        log.info('Running in debug mode with specific actor');
        const options = { memory: input.maxActorMemoryBytes } as ActorCallOptions;
        const { items } = await callActorGetDataset(input.debugActor!, input.debugActorInput!, process.env.APIFY_TOKEN, options);

        await Actor.pushData(items);
        log.info('Pushed items to dataset', { itemCount: items.count });
        await Actor.exit();
    } else {
        // Force STANDBY mode for MCP server functionality
        log.info('No debug actor specified, starting in MCP server mode');
        
        const app = createExpressApp(HOST, {
            enableAddingActors: Boolean(input.enableAddingActors),
            enableDefaultActors: true,
            actors: Array.isArray(input.actors) ? input.actors : (input.actors ? [input.actors] : []),
        });
        
        app.listen(PORT, () => {
            log.info('MCP server listening', { host: HOST, port: PORT });
        });
    }
}

// So Ctrl+C works locally
process.on('SIGINT', async () => {
    log.info('Received SIGINT, shutting down gracefully...');
    await Actor.exit();
});
