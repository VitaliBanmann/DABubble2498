import { provideServerRendering } from '@angular/ssr';
import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { appConfig } from './app.config';

/** Server-specific Angular providers. */
const serverConfig: ApplicationConfig = {
    providers: [provideServerRendering()],
};

/** Final application config used for server rendering. */
export const config = mergeApplicationConfig(appConfig, serverConfig);
