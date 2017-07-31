import {ajax} from 'src/ajax';
import adapter from 'src/AnalyticsAdapter';
import { analyticsRegistry } from 'src/analyticsAdapterRegistry';
const utils = require('src/utils');

/****
 * PubWise.io Analytics
 * Contact: support@pubwise.io
 * Developer: Stephen Johnston
 */

const analyticsType = 'endpoint';
let target_site = 'unknown';
let target_url = 'https://staging.api.pubwise.io';
let pw_version = '2.1.3';

const baseAdapterFactory = adapter(
  {
    target_url,
    analyticsType
  }
);

export default function adapterFactory(adapterDependencies) {
  const adapter = baseAdapterFactory(adapterDependencies);
  return Object.assign(adapter, {
    // Override AnalyticsAdapter functions by supplying custom methods
    track({eventType, args}) {
      /*
         The args object is not always available, in addition neither is the config object
         it is available on the first call and we can setup our config. Potential additional
         PR for later, but this solves this for now.
         */
      if (args !== undefined && args.config !== undefined && args.config.site !== undefined && args.config.endpoint !== undefined) {
        target_site = args.config.site;
        target_url = args.config.endpoint;
      }
      utils.logInfo('Sending PubWise Analytics Event ' + eventType, args);
      ajax(target_url,
        (result) => utils.logInfo('PubWise Analytics Result', result), JSON.stringify({
          eventType,
          args,
          target_site,
          pw_version
        })
      );
    }
  });
}


analyticsRegistry.registerInjectableAnalyticsAdapter({
  factory: adapterFactory,
  code: 'pubwise'
});
