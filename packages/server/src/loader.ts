import fs from 'fs';
import { resolve } from 'path';

import { Logger } from '@lightshow/core';

const { PLUGINS_PATH = '../../config/plugins' } = process.env;

interface Plugin {
  path: string;
  name: string;
  type: 'nextjs' | 'sms';
  module: any;
  instance?: any;
}

interface PluginManifest {
  name: string;
  path: string;
  type: Plugin['type'];
}

export function loadPlugins() {
  const logger = new Logger({ level: '*' });

  logger.debug({
    msg: 'Loading plugins.',
  });
  let plugins: Plugin[] = [];
  const pluginsPath = `${PLUGINS_PATH}/plugins.json`;

  if (!fs.existsSync(pluginsPath)) {
    logger.debug({
      msg: `No plugins config exists ${pluginsPath}`,
    });
    return plugins;
  }

  const pluginsManifest: PluginManifest[] = require(resolve(pluginsPath));
  pluginsManifest.forEach((entry) => {
    const plugin: Plugin = {
      path: entry.path,
      name: entry.name,
      type: entry.type,
      module: require(entry.path || entry.name).default,
    };

    if (plugin.type === 'nextjs') {
      plugin.instance = new plugin.module();
    }

    plugins.push(plugin);
  });

  return plugins;
}
