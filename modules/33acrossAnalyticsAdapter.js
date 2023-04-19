/* eslint-disable no-console */
import { logError, logWarn, logInfo, deepAccess } from '../src/utils.js';
import buildAdapter from '../libraries/analyticsAdapter/AnalyticsAdapter.js';
import adapterManager from '../src/adapterManager.js';
import CONSTANTS from '../src/constants.json';
const { EVENTS } = CONSTANTS;

const ANALYTICS_VERSION = '1.0.0';
const PROVIDER_NAME = '33across';
const DEFAULT_TRANSACTION_TIMEOUT = 3000;

const log = getLogger();

/**
 * @typedef {Object} AnalyticsReport Sent when all bids are complete (as determined by `bidWon` and `slotRenderEnded` events)
 * @property {string} siteId
 * @property {string} pid Partner ID
 * @property {string} src Source of the report (pbjs)
 * @property {string} analyticsVersion
 * @property {string} pbjsVersion
 * @property {Auction[]} auctions
 * @property {Bid[]} bidsWon
 */

/**
 * @typedef {Object} AnalyticsCache
 * @property {string} pid Partner ID
 * @property {Object<string, Auction>} auctions
 * @property {Object<string, Bid[]>} bidsWon
 */

/**
 * @typedef {Object} Auction
 * @property {AdUnit[]} adUnits
 * @property {string} auctionId
 * @property {Object} userIds
 */

/**
 * @typedef {Object} BidResponse
 * @property {number} cpm
 * @property {string} cur
 * @property {number} cpmOrig
 * @property {number} cpmFloor
 * @property {string} mediaType
 * @property {string} size
 */

/**
 * @typedef {Object} Bid
 * @property {string} bidder
 * @property {string} source
 * @property {string} status
 * @property {BidResponse} bidResponse
 * @property {string} [transactionId] // Only included for winning bids
 */

/**
 * @typedef {Object} AdUnit
 * @property {string} transactionId
 * @property {string} adUnitCode
 * @property {string} slotId
 * @property {Array<string>} mediaTypes
 * @property {Array<string>} sizes
 * @property {Array<Bid>} bids
 */

/**
 * After the first bid is initiated, we wait until every bid is completed before sending the report.
 *
 * We will listen for the `bidWon` event and for `slotRenderEnded` event from GAM to determine when
 * all bids are complete.
 */
class TransactionManager {
  #timeoutId = null;
  #pending = 0;
  #timeout;
  #transactions = {};
  #onComplete;

  get #unsent() {
    return this.#pending;
  }

  set #unsent(value) {
    this.#pending = value;

    if (this.#pending <= 0) {
      this.#clearTimeout();

      this.#onComplete();

      this.#transactions = {};
    }
  }

  constructor({ timeout, onComplete }) {
    this.#timeout = timeout;
    this.#onComplete = onComplete;
  }

  add(transactionId) {
    if (this.#transactions[transactionId]) {
      log.warn(`transactionId "${transactionId}" already exists`);

      return;
    }

    this.#transactions[transactionId] = {
      status: 'waiting'
    };
    ++this.#unsent;

    this.#restartSendTimeout();
  }

  que(transactionId) {
    if (!this.#transactions[transactionId]) {
      log.warn(`transactionId "${transactionId}" was not found. Nothing to enqueue.`);
      return;
    }
    this.#transactions[transactionId].status = 'queued';
    --this.#unsent;

    log.info(`Queued transaction "${transactionId}". ${this.#unsent} unsent.`, this.#transactions);
  }

  // gulp-eslint is using eslint 6, a version that doesn't support private method syntax
  // eslint-disable-next-line no-dupe-class-members
  #clearTimeout() {
    return window.clearTimeout(this.#timeoutId);
  }

  // eslint-disable-next-line no-dupe-class-members
  #restartSendTimeout() {
    this.#clearTimeout();

    this.#timeoutId = setTimeout(() => {
      if (this.#timeout !== 0) {
        log.warn(`Timed out waiting for ad transactions to complete. Sending report.`);
      }

      this.#unsent = 0;
    }, this.#timeout);
  }
}

/**
 * initialized during `enableAnalytics`
 */
export const locals = {
  /** @type {Object<string, TransactionManager>} */
  transactionManagers: {},
  /** @type {string} */
  endpoint: undefined,
  /** @type {AnalyticsCache} */
  analyticsCache: undefined,
  /** sets all locals to undefined */
  reset() {
    this.transactionManagers = {};
    this.endpoint = undefined;
    this.analyticsCache = undefined;
  }
}

const analyticsAdapter = Object.assign(
  buildAdapter({ analyticsType: 'endpoint' }),
  { track: analyticEventHandler }
);

analyticsAdapter.originEnableAnalytics = analyticsAdapter.enableAnalytics;
analyticsAdapter.enableAnalytics = enableAnalyticsWrapper;

/**
 * @param {Object} [config] Analytics module configuration
 */
function enableAnalyticsWrapper(config = {}) {
  const { options = {} } = config;
  const endpoint = options.endpoint;

  if (!endpoint) {
    log.error('No endpoint provided for "options.endpoint". No analytics will be sent.');

    return;
  }

  const pid = options.pid;
  if (!pid) {
    log.error('No partnerId provided for "options.pid". No analytics will be sent.');

    return;
  }

  this.getUrl = () => endpoint;

  const timeout = calculateTransactionTimeout(options.timeout);
  this.getTimeout = () => timeout;

  locals.analyticsCache = newAnalyticsCache(pid);

  analyticsAdapter.originEnableAnalytics(config);
}

/**
 * @param {number|undefined} configTimeout
 * @return {number} Transaction Timeout
 */
function calculateTransactionTimeout(configTimeout) {
  if (typeof configTimeout === 'undefined') {
    return DEFAULT_TRANSACTION_TIMEOUT;
  }

  if (typeof configTimeout === 'number' && configTimeout >= 0) {
    return configTimeout;
  }

  log.info(`Invalid timeout provided for "options.timeout". Using default timeout of 3000ms.`);

  return DEFAULT_TRANSACTION_TIMEOUT;
}

/**
 * @param {TransacionManager} transactionManager
 */
function subscribeToGamSlotRenderEvent(transactionManager) {
  window.googletag = window.googletag || {};
  window.googletag.cmd = window.googletag.cmd || [];
  window.googletag.cmd.push(() => {
    window.googletag.pubads().addEventListener('slotRenderEnded', event => {
      log.info('slotRenderEnded', event);

      const slot = `${event.slot.getAdUnitPath()}:${event.slot.getSlotElementId()}`;

      transactionManager.que(slot);
    });
  });
}

/** necessary for testing */
analyticsAdapter.originDisableAnalytics = analyticsAdapter.disableAnalytics;
analyticsAdapter.disableAnalytics = function () {
  analyticsAdapter._oldEnable = enableAnalyticsWrapper;
  locals.reset();
  analyticsAdapter.originDisableAnalytics();
};

adapterManager.registerAnalyticsAdapter({
  adapter: analyticsAdapter,
  code: PROVIDER_NAME,
  gvlid: 58,
});

export default analyticsAdapter;

/**
 * @param {string} pid Partner ID
 * @returns {AnalyticsCache}
 */
function newAnalyticsCache(pid) {
  return {
    pid,
    auctions: {},
    bidsWon: {},
  };
}

/**
 * @param {AnalyticsCache} analyticsCache
 * @param {string} completedAuctionId
 * @return {AnalyticsReport} Analytics report
 */
function createReportFromCache(analyticsCache, completedAuctionId) {
  const { pid, bidsWon, auctions } = analyticsCache;

  return {
    siteId: '', // FIXME: possibly remove, awaiting more information222222
    pid,
    src: 'pbjs',
    analyticsVersion: ANALYTICS_VERSION,
    pbjsVersion: '$prebid.version$', // Replaced by build script
    auctions: [ auctions[completedAuctionId] ],
    bidsWon: bidsWon[completedAuctionId]
  }
}

/**
 * @param {Object} args
 * @param {Array} args.adUnits
 * @param {string} args.auctionId
 * @param {Array} args.bidderRequests
 * @returns {Auction}
 */
function parseAuction({ adUnits, auctionId, bidderRequests }) {
  if (typeof auctionId !== 'string' || !Array.isArray(bidderRequests)) {
    log.error('Analytics adapter failed to parse auction.');
  }

  return {
    adUnits: adUnits.map(unit => parseAdUnit(unit)),
    auctionId,
    userIds: Object.keys(deepAccess(bidderRequests, '0.bids.0.userId', {}))
  }
}

/**
 * @param {Object} args
 * @param {string} args.transactionId
 * @param {string} args.code
 * @param {string} args.slotId
 * @param {Array<string>} args.mediaTypes
 * @param {Array<string>} args.sizes
 * @returns {AdUnit}
 */
function parseAdUnit({ transactionId, code, slotId, mediaTypes, sizes }) {
  log.warn(`parsing adUnit, slotId not yet implemented`);

  return {
    transactionId,
    adUnitCode: code,
    slotId: '', // FIXME: slot ID has to be populated from the slotRenderEnded event
    mediaTypes: Object.keys(mediaTypes),
    sizes: sizes.map(size => size.join('x')),
    bids: []
  }
}

/**
 * @param {Object} args
 * @param {string} args.auctionId
 * @param {string} args.bidder
 * @param {string} args.source
 * @param {string} args.status
 * @param {Object} args.args
 * @returns {Bid}
 */
function parseBid({ auctionId, bidder, source, status, ...args }) {
  return {
    bidder,
    source,
    status,
    bidResponse: parseBidResponse(args)
  }
}

/**
 * @param {Object} args
 * @param {number} args.cpm
 * @param {string} args.currency
 * @param {number} args.originalCpm
 * @param {Object} args.floorData
 * @param {string} args.mediaType
 * @param {string} args.size
 * @returns {BidResponse}
 */
function parseBidResponse({ cpm, currency, originalCpm, floorData, mediaType, size }) {
  return {
    cpm,
    cur: currency,
    cpmOrig: originalCpm,
    cpmFloor: floorData?.cpmAfterAdjustments,
    mediaType,
    size
  }
}

/**
 * @param {Object} args
 * @param {Object} args.args Event data
 * @param {EVENTS[keyof EVENTS]} args.eventType
 */
function analyticEventHandler({ eventType, args }) {
  switch (eventType) {
    case EVENTS.AUCTION_INIT:
      const auction = parseAuction(args);

      locals.analyticsCache.auctions[auction.auctionId] = auction;
      locals.analyticsCache.bidsWon[args.auctionId] = [];

      const transactionManager = locals.transactionManagers[args.auctionId] ||=
        new TransactionManager({
          timeout: analyticsAdapter.getTimeout(),
          onComplete() {
            sendReport(createReportFromCache(locals.analyticsCache, auction.auctionId),
              analyticsAdapter.getUrl());
          }
        });

      subscribeToGamSlotRenderEvent(transactionManager);

      break;
    case EVENTS.BID_REQUESTED:
      args.bids.forEach((bid) => {
        locals.transactionManagers[args.auctionId].add(bid.transactionId);
      });

      break;
    case EVENTS.BID_RESPONSE:
      const bidResponse = parseBid(args);
      const cachedAuction = locals.analyticsCache.auctions[args.auctionId];
      const cachedAdUnit = cachedAuction.adUnits.find(adUnit => adUnit.transactionId === args.transactionId);

      cachedAdUnit.bids.push(bidResponse);

      break;
    case EVENTS.BID_WON:
      const bidWon = Object.assign(parseBid(args), {
        transactionId: args.transactionId
      });

      const auctionBids = locals.analyticsCache.bidsWon[args.auctionId];

      auctionBids.push(bidWon);

      // eslint-disable-next-line no-unused-expressions
      locals.transactionManagers[args.auctionId]?.que(bidWon.transactionId);

      break;
    default:
      break;
  }
}

/**
 * Guarantees sending of data without waiting for response, even after page is left/closed
 *
 * @param {AnalyticsReport} report Request payload
 * @param {string} endpoint URL
 */
function sendReport(report, endpoint) {
  if (navigator.sendBeacon(endpoint, JSON.stringify(report))) {
    log.info(`Analytics report sent to ${endpoint}`, report);

    return;
  }

  log.error('Analytics report exceeded User-Agent data limits and was not sent.', report);
}

/**
 * Encapsute certain logger functions and add a prefix to the final messages.
 *
 * @return {Object} New logger functions
 */
function getLogger() {
  const LPREFIX = `${PROVIDER_NAME} Analytics: `;

  return {
    info: (msg, ...args) => logInfo(`${LPREFIX}${msg}`, ...args),
    warn: (msg, ...args) => logWarn(`${LPREFIX}${msg}`, ...args),
    error: (msg, ...args) => logError(`${LPREFIX}${msg}`, ...args),
  }
}
