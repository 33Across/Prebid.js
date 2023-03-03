/**
 * This module adds 33acrossId to the User ID module
 * The {@link module:modules/userId} module is required
 * @module modules/33acrossIdSystem
 * @requires module:modules/userId
 */

import { logMessage, logError } from '../src/utils.js';
import { ajaxBuilder } from '../src/ajax.js';
import { submodule } from '../src/hook.js';
import { uspDataHandler } from '../src/adapterManager.js';
import { getStorageManager } from '../src/storageManager.js';

const MODULE_NAME = '33acrossId';
const EXT_KEY = `${MODULE_NAME}_ext`;
const API_URL = 'https://lexicon.33across.com/v1/envelope';
const AJAX_TIMEOUT = 10000;
const CALLER_NAME = 'pbjs';
const GVLID = 58;

export const storage = getStorageManager({ gvlid: GVLID, moduleName: MODULE_NAME });

function calculateResponseObj(response) {
  if (!response.succeeded) {
    logError(`${MODULE_NAME}: Unsuccessful response`);

    return {};
  }

  if (!response.data.envelope) {
    logMessage(`${MODULE_NAME}: No envelope was received`);

    return {};
  }

  return {
    envelope: response.data.envelope,
    ext: response.data.ext
  };
}

function calculateQueryStringParams(pid, gdprConsentData) {
  const uspString = uspDataHandler.getConsentData();
  const gdprApplies = Boolean(gdprConsentData?.gdprApplies);
  const params = {
    pid,
    gdpr: Number(gdprApplies),
    src: CALLER_NAME,
    ver: '$prebid.version$'
  };

  if (uspString) {
    params.us_privacy = uspString;
  }

  if (gdprApplies) {
    params.gdpr_consent = gdprConsentData.consentString || '';
  }

  return params;
}

/** @type {Submodule} */
export const thirthyThreeAcrossIdSubmodule = {
  /**
   * used to link submodule with config
   * @type {string}
   */
  name: MODULE_NAME,

  gvlid: 58,

  /**
   * decode the stored id value for passing to bid requests
   * @function
   * @param {string} id
   * @returns {{'33acrossId':{ envelope: string}, <string>: { id: string, ext: Object }}}
   */
  decode(id) {
    const ext =
      JSON.parse(storage.getDataFromLocalStorage('33acrossId_ext') || '{}');

    return {
      [MODULE_NAME]: {
        envelope: id
      },
      ...ext.eids
    };
  },

  /**
   * performs action to obtain id and return a value in the callback's response argument
   * @function
   * @param {SubmoduleConfig} [config]
   * @returns {IdResponse|undefined}
   */
  getId({ params = { } }, gdprConsentData) {
    if (typeof params.pid !== 'string') {
      logError(`${MODULE_NAME}: Submodule requires a partner ID to be defined`);

      return;
    }

    const { pid, apiUrl = API_URL } = params;

    return {
      callback(cb) {
        ajaxBuilder(AJAX_TIMEOUT)(apiUrl, {
          success(response) {
            let responseObj = { };

            try {
              responseObj = calculateResponseObj(JSON.parse(response));
            } catch (err) {
              logError(`${MODULE_NAME}: ID reading error:`, err);
            }

            if (responseObj.ext) {
              storage.setDataInLocalStorage(EXT_KEY, JSON.stringify(responseObj.ext));
            }

            cb(responseObj.envelope);
          },
          error(err) {
            logError(`${MODULE_NAME}: ID error response`, err);

            cb();
          }
        }, calculateQueryStringParams(pid, gdprConsentData), { method: 'GET', withCredentials: true });
      }
    };
  }
};

submodule('userId', thirthyThreeAcrossIdSubmodule);
