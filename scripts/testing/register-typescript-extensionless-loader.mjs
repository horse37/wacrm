import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register(
  './scripts/testing/typescript-extensionless-loader.mjs',
  pathToFileURL('./')
);
