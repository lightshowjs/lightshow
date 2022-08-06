import Koa from 'koa';
import http from 'http';

import { Server as SocketIOServer } from 'socket.io';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import serve from 'koa-static';
import path from 'path';

import { loadPlugins } from './loader';

import { Playlist, Console, Logger, SMSConfig } from '@lightshow/core';

import { playlistRouter, consoleRouter } from './routes';

const plugins = loadPlugins();

const {
  SMS_PROVIDER = 'none',
  TRACKS_PATH = '../../config/tracks',
  ELEMENTS_PATH = '../../config/elements',
  PORT = '3000',
} = process.env;

(async () => {
  const nextPlugins = plugins.filter((p) => p.type === 'nextjs');

  for (const nextPlugin of nextPlugins) {
    await nextPlugin.instance?.prepare();
  }

  const playlist = new Playlist({ path: TRACKS_PATH });

  try {
    playlist.loadPlaylist();
  } catch (err) {
    console.error(err);
    return;
  }

  const app = new Koa();
  const router = new Router();
  const server = http.createServer(app.callback());
  const io = new SocketIOServer(server);
  const logger = new Logger({ level: '*' });

  const trackConsole = new Console({ io, playlist, logger });

  // Only one SMS plugin will be instantiated
  const smsPlugin = plugins.find((p) => p.type === 'sms');

  const smsController = smsPlugin?.module({
    config: { provider: SMS_PROVIDER as SMSConfig['provider'] },
    console: trackConsole,
    logger,
  });

  router.get('/test-io', async (ctx) => {
    const { note, event, velocity, length, sameNotes } = ctx.query;

    if (note) {
      const notes = (note as string).split(',');
      notes.forEach((n) => {
        io.emit(
          event as string,
          n,
          parseInt((velocity as string) || '0'),
          length ? parseInt(length as string) : undefined,
          sameNotes ? (sameNotes as string).split(',') : undefined
        );
      });
    } else {
      io.emit(event as string);
    }

    ctx.body = { event, note, velocity };
  });

  if (smsController) {
    const webhookHandler = smsController.getWebhookHandler();
    logger.debug({
      msg: 'Registering SMS webhook route',
      path: webhookHandler.path,
    });
    router.register(
      webhookHandler.path,
      [webhookHandler.method],
      webhookHandler.handler
    );
  }

  router.all('(.*)', async (ctx) => {
    for (const nextPlugin of nextPlugins) {
      await nextPlugin.instance?.handler(ctx.req, ctx.res);
    }

    ctx.respond = false;
  });

  playlistRouter.prefix('/api');
  consoleRouter.prefix('/api');

  const tracksServeHandler = serve(path.resolve(TRACKS_PATH));
  const elementsServeHandler = serve(path.resolve(ELEMENTS_PATH));

  app
    .use(bodyParser())
    .use(async (ctx, next) => {
      ctx.res.statusCode = 200;
      if (ctx.path === '/') {
        ctx.body = 'Welcome to @lightshow';
        return;
      }
      await next();
    })
    .use(async (ctx, next) => {
      ctx.state.playlist = playlist;
      ctx.state.logger = logger;
      ctx.state.trackConsole = trackConsole;
      await next();
    })
    .use(playlistRouter.routes())
    .use(consoleRouter.routes())
    .use(async (ctx, next) => {
      if (ctx.path.startsWith('/audio')) {
        ctx.path = ctx.path.replace('/audio', '');

        // Set this for seeking in Chrome
        ctx.set('Accept-Ranges', 'bytes');

        await tracksServeHandler(ctx, next);
        return;
      }
      if (ctx.path.startsWith('/elements')) {
        ctx.path = ctx.path.replace('/elements', '');

        await elementsServeHandler(ctx, next);
        return;
      }
      await next();
    })
    // this should be last
    .use(router.routes());

  await server.listen(Number(PORT));
  console.log('Service started');
})();
