import { expect } from 'chai';

import analyticsAdapter from 'modules/33acrossAnalyticsAdapter.js';

import * as mockGpt from 'test/spec/integration/faker/googletag.js';

import * as utils from 'src/utils.js';
import * as events from 'src/events.js';
import CONSTANTS from 'src/constants.json';
const { EVENTS } = CONSTANTS;

describe.only('33acrossAnalyticsAdapter:', function() {
  let sandbox, clock;

  beforeEach(function() {
    mockGpt.enable();
    sandbox = sinon.sandbox.create();
    clock = sandbox.useFakeTimers(1680287706002);
  });

  afterEach(function() {
    sandbox.restore();
    analyticsAdapter.disableAnalytics();
    events.clearEvents();
  });

  describe('enableAnalytics', function() {
    context('when endpoint hasn\'t been given', function() {
      it('logs an error', function() {
        sandbox.spy(utils, 'logError');

        analyticsAdapter.enableAnalytics({
          provider: '33across',
          options: {
            pid: 'test-pid',
          },
        });

        sinon.assert.calledOnce(utils.logError);
        sinon.assert.calledWithExactly(utils.logError, '33across Analytics: No endpoint provided for "options.endpoint". No analytics will be sent.');
      });
    });

    context('when pid hasn\'t been given', function() {
      it('logs an error', function() {
        sandbox.spy(utils, 'logError');
        analyticsAdapter.enableAnalytics({
          provider: '33across',
          options: {
            endpoint: 'test-endpoint',
          },
        });

        sinon.assert.calledOnce(utils.logError);
        sinon.assert.calledWithExactly(utils.logError, '33across Analytics: No partnerId provided for "options.pid". No analytics will be sent.');
      });
    });

    context('when pid and endpoint have been given', function() {
      context('and an invalid timeout config value has been given', function() {
        it('logs an info message', function() {
          sandbox.spy(utils, 'logInfo');

          [ null, 'foo', -1 ].forEach((value, index) => {
            analyticsAdapter.enableAnalytics({
              provider: '33across',
              options: {
                pid: 'test-pid',
                endpoint: 'test-endpoint',
                timeout: value
              },
            });
            analyticsAdapter.disableAnalytics();

            sinon.assert.calledWithExactly(utils.logInfo.getCall(index), '33across Analytics: Invalid timeout provided for "options.timeout". Using default timeout of 3000ms.');
          });
        });
      });

      it('logs any received GAM slotRenderEnded event', function() {
        sandbox.spy(utils, 'logInfo');

        analyticsAdapter.enableAnalytics({
          provider: '33across',
          options: {
            pid: 'test-pid',
            endpoint: 'test-endpoint'
          },
        });

        performAuctionWithMissingBidWon();

        window.googletag.cmd.forEach(fn => fn());

        const { gam } = getMockEvents();
        const [ gEvent ] = gam.slotRenderEnded;

        mockGpt.emitEvent('slotRenderEnded', gEvent);

        sinon.assert.calledWithExactly(utils.logInfo, '33across Analytics: slotRenderEnded', Object.assign({ eventName: 'slotRenderEnded' }, gEvent));
      });
    });
  });

  describe('when handling events', function() {
    beforeEach(function() {
      this.defaultTimeout = 3000;
      this.enableAnalytics = (options) => {
        analyticsAdapter.enableAnalytics({
          provider: '33across',
          options: {
            endpoint: 'test-endpoint',
            pid: 'test-pid',
            timeout: this.defaultTimeout,
            ...options
          },
        });
      }
    });

    context('when an auction is complete', function() {
      context('and the AnalyticsReport is sent successfully to the given endpoint', function() {
        it('logs an info message', function() {
          sandbox.spy(utils, 'logInfo');

          this.enableAnalytics({ endpoint: 'foo-endpoint' });

          sandbox.stub(navigator, 'sendBeacon')
            .withArgs('foo-endpoint', JSON.stringify(getStandardAnalyticsReport()))
            .returns(true);

          performStandardAuction();

          clock.tick(this.defaultTimeout + 1);

          sinon.assert.calledOnce(navigator.sendBeacon);
          sinon.assert.calledWithExactly(utils.logInfo, '33across Analytics: Analytics report sent to foo-endpoint', sinon.match.object);
        });
      });
    });

    context('when an error occurs while sending the AnalyticsReport', function() {
      it('logs an error', function() {
        sandbox.spy(utils, 'logError');
        this.enableAnalytics();

        sandbox.stub(navigator, 'sendBeacon').returns(false);
        performStandardAuction();
        clock.tick(this.defaultTimeout + 1);

        sinon.assert.calledOnce(utils.logError);
        sinon.assert.calledWith(utils.logError, '33across Analytics: Analytics report exceeded User-Agent data limits and was not sent.', sinon.match.object);
      });
    });

    context('when a bid-won event is received', function() {
      context('and there\'s no record of that bid being requested', function() {
        it('logs a warning message', function() {
          sandbox.spy(utils, 'logWarn');

          this.enableAnalytics();

          const mockEvents = getMockEvents();
          const { prebid } = mockEvents;
          const [ auction ] = prebid;

          events.emit(EVENTS.AUCTION_INIT, auction.AUCTION_INIT);

          const fakeBidWonEvent = Object.assign(auction.BID_WON[0], {
            transactionId: 'foo'
          })

          events.emit(EVENTS.BID_WON, fakeBidWonEvent);

          sinon.assert.calledWithExactly(utils.logWarn, '33across Analytics: transactionId "foo" was not found. Nothing to enqueue.');
        });
      });
    });

    context('when the same bid-won event is received more than once', function() {
      it('logs a warning message', function() {
        sandbox.spy(utils, 'logWarn');

        this.enableAnalytics();

        const mockEvents = getMockEvents();
        const { prebid } = mockEvents;
        const [ auction ] = prebid;

        events.emit(EVENTS.AUCTION_INIT, auction.AUCTION_INIT);
        events.emit(EVENTS.AUCTION_INIT, auction.AUCTION_INIT);

        sinon.assert.calledWithExactly(utils.logWarn, '33across Analytics: transactionId "ef947609-7b55-4420-8407-599760d0e373" already exists')
      });
    });

    context('when a transaction doesn\'t reach its complete state', function() {
      context('and a timeout config value has been given', function() {
        context('and the timeout value has elapsed', function() {
          it('logs an error', function() {
            this.enableAnalytics({ timeout: 2000 });

            sandbox.spy(utils, 'logWarn');

            performAuctionWithMissingBidWon();

            clock.tick(2001);

            sinon.assert.calledWithExactly(utils.logWarn, '33across Analytics: Timed out waiting for ad transactions to complete. Sending report.');
          });
        })
      });

      context('when a timeout config value hasn\'t been given', function() {
        context('and the default timeout has elapsed', function() {
          it('logs an error', function() {
            this.enableAnalytics();

            sandbox.spy(utils, 'logWarn');

            performAuctionWithMissingBidWon();

            clock.tick(this.defaultTimeout + 1);

            sinon.assert.calledWithExactly(utils.logWarn, '33across Analytics: Timed out waiting for ad transactions to complete. Sending report.');
          });
        })
      });

      context('and the incomplete report has been sent successfully', function() {
        it('logs an info message', function() {
          sandbox.spy(utils, 'logInfo');
          const incompleteAnalyticsReport = Object.assign(
            getStandardAnalyticsReport(),
            { bidsWon: [] }
          );

          sandbox.stub(navigator, 'sendBeacon')
            .withArgs('foo-endpoint', JSON.stringify(incompleteAnalyticsReport))
            .returns(true);

          this.enableAnalytics({ endpoint: 'foo-endpoint' });

          performAuctionWithMissingBidWon();

          clock.tick(this.defaultTimeout + 1);

          sinon.assert.calledOnce(navigator.sendBeacon);
          sinon.assert.calledWithExactly(utils.logInfo, '33across Analytics: Analytics report sent to foo-endpoint', sinon.match.object);
        });
      });
    });
  });
});

/**
 * Events in possible order of execution
 * ADD_AD_UNITS
 * REQUEST_BIDS
 * BEFORE_REQUEST_BIDS
 * AUCTION_INIT
 * BID_REQUESTED
 * BEFORE_BIDDER_HTTP
 * NO_BID
 * BIDDER_DONE
 * BID_ADJUSTMENT
 * BID_RESPONSE
 * BIDDER_DONE
 * NO_BID
 * TCF2_ENFORCEMENT
 * AUCTION_END
 * SET_TARGETING
 * BIDDER_DONE
 * - GAM SLOT RENDER EVENT
 * BID_WON
 * AD_RENDER_SUCCEEDED
 * AD_RENDER_FAILED
 * BID_TIMEOUT
 */

function performStandardAuction() {
  const mockEvents = getMockEvents();
  const { prebid, gam } = mockEvents;

  for (let auction of prebid) {
    events.emit(EVENTS.AUCTION_INIT, auction.AUCTION_INIT);

    auction.BID_RESPONSE.forEach((bidResponseEvent) => {
      events.emit(EVENTS.BID_RESPONSE, bidResponseEvent);
    });

    events.emit(EVENTS.AUCTION_END, auction.AUCTION_END);

    for (let gEvent of gam.slotRenderEnded) {
      mockGpt.emitEvent(gEvent);
    }

    auction.BID_WON.forEach((bidWonEvent) => {
      events.emit(EVENTS.BID_WON, bidWonEvent);
    });
  }
}

function performAuctionWithMissingBidWon() {
  const mockEvents = getMockEvents();
  let { prebid } = mockEvents;

  const [ auction ] = prebid;

  events.emit(EVENTS.AUCTION_INIT, auction.AUCTION_INIT);

  auction.BID_RESPONSE.forEach((bidResponseEvent) => {
    events.emit(EVENTS.BID_RESPONSE, bidResponseEvent);
  });

  events.emit(EVENTS.AUCTION_END, auction.AUCTION_END);
}

function getStandardAnalyticsReport() {
  return {
    siteId: '',
    pid: 'test-pid',
    src: 'pbjs',
    analyticsVersion: '1.0.0',
    pbjsVersion: '7.44.0-pre',
    auctions: [{
      adUnits: [{
        transactionId: 'ef947609-7b55-4420-8407-599760d0e373',
        adUnitCode: '/19968336/header-bid-tag-0',
        slotId: '',
        mediaTypes: ['banner'],
        sizes: ['300x250', '300x600'],
        bids: [{
          bidder: 'bidder0',
          source: 'client',
          status: 'rendered',
          transactionId: 'ef947609-7b55-4420-8407-599760d0e373',
          bidResponse: {
            cpm: 1.5,
            cur: 'USD',
            cpmOrig: 1.5,
            cpmFloor: 1,
            mediaType: 'banner',
            size: '300x250'
          }
        }]
      }, {
        transactionId: 'abab4423-d962-41aa-adc7-0681f686c330',
        adUnitCode: '/19968336/header-bid-tag-1',
        slotId: '',
        mediaTypes: ['banner'],
        sizes: ['728x90', '970x250'],
        bids: [{
          bidder: 'bidder0',
          source: 'client',
          status: 'targetingSet',
          transactionId: 'abab4423-d962-41aa-adc7-0681f686c330',
          bidResponse: {
            cpm: 1.5,
            cur: 'USD',
            cpmOrig: 1.5,
            cpmFloor: 1,
            mediaType: 'banner',
            size: '728x90'
          }
        }]
      }, {
        transactionId: 'b43e7487-0a52-4689-a0f7-d139d08b1f9f',
        adUnitCode: '/17118521/header-bid-tag-2',
        slotId: '',
        mediaTypes: ['banner'],
        sizes: ['300x250'],
        bids: []
      }],
      auctionId: 'auction-000',
      userIds: ['33acrossId']
    }],
    bidsWon: [{
      bidder: 'bidder0',
      source: 'client',
      status: 'rendered',
      transactionId: 'ef947609-7b55-4420-8407-599760d0e373',
      bidResponse: {
        cpm: 1.5,
        cur: 'USD',
        cpmOrig: 1.5,
        cpmFloor: 1,
        mediaType: 'banner',
        size: '300x250'
      }
    }, {
      bidder: 'bidder0',
      source: 'client',
      status: 'rendered',
      transactionId: 'abab4423-d962-41aa-adc7-0681f686c330',
      bidResponse: {
        cpm: 1.5,
        cur: 'USD',
        cpmOrig: 1.5,
        cpmFloor: 1,
        mediaType: 'banner',
        size: '728x90'
      }
    }, {
      bidder: 'bidder0',
      source: 'client',
      status: 'targetingSet',
      transactionId: 'b43e7487-0a52-4689-a0f7-d139d08b1f9f',
      bidResponse: {
        cpm: 1.5,
        cur: 'USD',
        cpmOrig: 1.5,
        cpmFloor: 1,
        mediaType: 'banner',
        size: '728x90'
      }
    }]
  };
}

function getMockEvents() {
  const ad = '<!-- Creative --><div>ad</div>';
  const auctionId = 'auction-000';

  return {
    gam: {
      slotRenderEnded: [
        {
          serviceName: 'publisher_ads',
          slot: mockGpt.makeSlot({ code: 'box' }),
          isEmpty: true,
          slotContentChanged: true,
          size: null,
          advertiserId: null,
          campaignId: null,
          creativeId: null,
          creativeTemplateId: null,
          labelIds: null,
          lineItemId: null,
          isBackfill: false,
        },
        {
          serviceName: 'publisher_ads',
          slot: mockGpt.makeSlot({ code: 'box' }),
          isEmpty: false,
          slotContentChanged: true,
          size: [1, 1],
          advertiserId: 12345,
          campaignId: 400000001,
          creativeId: 6789,
          creativeTemplateId: null,
          labelIds: null,
          lineItemId: 1011,
          isBackfill: false,
          yieldGroupIds: null,
          companyIds: null,
        },
        {
          serviceName: 'publisher_ads',
          slot: mockGpt.makeSlot({ code: 'box' }),
          isEmpty: false,
          slotContentChanged: true,
          size: [728, 90],
          advertiserId: 12346,
          campaignId: 299999000,
          creativeId: 6790,
          creativeTemplateId: null,
          labelIds: null,
          lineItemId: 1012,
          isBackfill: false,
          yieldGroupIds: null,
          companyIds: null,
        },
      ],
    },
    prebid: [{
      AUCTION_INIT: {
        auctionId,
        timestamp: 1680279732944,
        auctionStatus: 'inProgress',
        adUnits: [
          {
            code: '/19968336/header-bid-tag-0',
            mediaTypes: {
              banner: {
                sizes: [
                  [300, 250],
                  [300, 600],
                ],
              },
            },
            bids: [
              {
                bidder: 'bidder0',
                params: {
                  placementId: 12345678,
                },
                userId: {
                  '33acrossId': {
                    envelope:
                      'v1.0014',
                  },
                },
                userIdAsEids: [
                  {
                    source: '33across.com',
                    uids: [
                      {
                        id: 'v1.0014',
                        atype: 1,
                      },
                    ],
                  },
                ],
                crumbs: {
                  pubcid: 'badbbf35-1573-47c5-948e-70a63f9271f4',
                },
              },
            ],
            sizes: [
              [300, 250],
              [300, 600],
            ],
            transactionId: 'ef947609-7b55-4420-8407-599760d0e373',
            ortb2Imp: {
              ext: {
                tid: 'ef947609-7b55-4420-8407-599760d0e373',
                data: {
                  adserver: {
                    name: 'gam',
                    adslot: '/19968336/header-bid-tag-0',
                  },
                  pbadslot: '/19968336/header-bid-tag-0',
                },
                gpid: '/19968336/header-bid-tag-0',
              },
            },
          },
          {
            code: '/19968336/header-bid-tag-1',
            mediaTypes: {
              banner: {
                sizes: [
                  [728, 90],
                  [970, 250],
                ],
              },
            },
            bids: [
              {
                bidder: 'bidder0',
                params: {
                  placementId: 12345678,
                },
                userId: {
                  '33acrossId': {
                    envelope:
                      'v1.0014',
                  },
                },
                userIdAsEids: [
                  {
                    source: '33across.com',
                    uids: [
                      {
                        id: 'v1.0014',
                        atype: 1,
                      },
                    ],
                  },
                ],
                crumbs: {
                  pubcid: 'badbbf35-1573-47c5-948e-70a63f9271f4',
                },
              },
            ],
            sizes: [
              [728, 90],
              [970, 250],
            ],
            transactionId: 'abab4423-d962-41aa-adc7-0681f686c330',
            ortb2Imp: {
              ext: {
                tid: 'abab4423-d962-41aa-adc7-0681f686c330',
                data: {
                  adserver: {
                    name: 'gam',
                    adslot: '/19968336/header-bid-tag-1',
                  },
                  pbadslot: '/19968336/header-bid-tag-1',
                },
                gpid: '/19968336/header-bid-tag-1',
              },
            },
          },
          {
            code: '/17118521/header-bid-tag-2',
            mediaTypes: {
              banner: {
                sizes: [[300, 250]],
              },
            },
            floors: {
              currency: 'USD',
              schema: {
                delimiter: '|',
                fields: ['mediaType', 'size'],
              },
              values: {
                'banner|300x250': 0.01,
              },
            },
            bids: [
              {
                bidder: '33across',
                params: {
                  siteId: 'dukr5O4SWr6iygaKkGJozW',
                  productId: 'siab',
                },
                userId: {
                  '33acrossId': {
                    envelope:
                      'v1.0014',
                  },
                },
                userIdAsEids: [
                  {
                    source: '33across.com',
                    uids: [
                      {
                        id: 'v1.0014',
                        atype: 1,
                      },
                    ],
                  },
                ],
                crumbs: {
                  pubcid: 'badbbf35-1573-47c5-948e-70a63f9271f4',
                },
              },
              {
                bidder: 'bidder0',
                params: {
                  placementId: 20216405,
                },
                userId: {
                  '33acrossId': {
                    envelope:
                      'v1.0014',
                  },
                },
                userIdAsEids: [
                  {
                    source: '33across.com',
                    uids: [
                      {
                        id: 'v1.0014',
                        atype: 1,
                      },
                    ],
                  },
                ],
                crumbs: {
                  pubcid: 'badbbf35-1573-47c5-948e-70a63f9271f4',
                },
              },
            ],
            sizes: [[300, 250]],
            transactionId: 'b43e7487-0a52-4689-a0f7-d139d08b1f9f',
            ortb2Imp: {
              ext: {
                tid: 'b43e7487-0a52-4689-a0f7-d139d08b1f9f',
                data: {
                  adserver: {
                    name: 'gam',
                    adslot: '/17118521/header-bid-tag-2',
                  },
                  pbadslot: '/17118521/header-bid-tag-2',
                },
                gpid: '/17118521/header-bid-tag-2',
              },
            },
          },
        ],
        adUnitCodes: [
          '/19968336/header-bid-tag-0',
          '/19968336/header-bid-tag-1',
          '/17118521/header-bid-tag-2',
        ],
        bidderRequests: [
          {
            bidderCode: 'bidder0',
            auctionId,
            bidderRequestId: '196b58215c10dc9',
            bids: [
              {
                bidder: 'bidder0',
                params: {
                  placement_id: 12345678,
                },
                userId: {
                  '33acrossId': {
                    envelope:
                      'v1.0014',
                  },
                },
                userIdAsEids: [
                  {
                    source: '33across.com',
                    uids: [
                      {
                        id: 'v1.0014',
                        atype: 1,
                      },
                    ],
                  },
                ],
                crumbs: {
                  pubcid: 'badbbf35-1573-47c5-948e-70a63f9271f4',
                },
                ortb2Imp: {
                  ext: {
                    tid: 'ef947609-7b55-4420-8407-599760d0e373',
                    data: {
                      adserver: {
                        name: 'gam',
                        adslot: '/19968336/header-bid-tag-0',
                      },
                      pbadslot: '/19968336/header-bid-tag-0',
                    },
                    gpid: '/19968336/header-bid-tag-0',
                  },
                },
                mediaTypes: {
                  banner: {
                    sizes: [
                      [300, 250],
                      [300, 600],
                    ],
                  },
                },
                adUnitCode: '/19968336/header-bid-tag-0',
                transactionId: 'ef947609-7b55-4420-8407-599760d0e373',
                sizes: [
                  [300, 250],
                  [300, 600],
                ],
                bidId: '20661fc5fbb5d9b',
                bidderRequestId: '196b58215c10dc9',
                auctionId,
                src: 'client',
                bidRequestsCount: 1,
                bidderRequestsCount: 1,
                bidderWinsCount: 0,
                ortb2: {
                  site: {
                    page: 'https://site.example.com/pb.html',
                    domain: 'site.example.com',
                    publisher: {
                      domain: 'site.example.com',
                    },
                  },
                  device: {
                    w: 594,
                    h: 976,
                    dnt: 0,
                    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36',
                    language: 'en',
                    sua: {
                      source: 2,
                      platform: {
                        brand: 'macOS',
                        version: ['13', '2', '1'],
                      },
                      browsers: [
                        {
                          brand: 'Google Chrome',
                          version: ['111', '0', '5563', '110'],
                        },
                        {
                          brand: 'Not(A:Brand',
                          version: ['8', '0', '0', '0'],
                        },
                        {
                          brand: 'Chromium',
                          version: ['111', '0', '5563', '110'],
                        },
                      ],
                      mobile: 0,
                      model: '',
                      bitness: '64',
                      architecture: 'arm',
                    },
                  },
                },
              },
              {
                bidder: 'bidder0',
                params: {
                  placement_id: 12345678,
                },
                userId: {
                  '33acrossId': {
                    envelope:
                      'v1.0014',
                  },
                },
                userIdAsEids: [
                  {
                    source: '33across.com',
                    uids: [
                      {
                        id: 'v1.0014',
                        atype: 1,
                      },
                    ],
                  },
                ],
                crumbs: {
                  pubcid: 'badbbf35-1573-47c5-948e-70a63f9271f4',
                },
                ortb2Imp: {
                  ext: {
                    tid: 'abab4423-d962-41aa-adc7-0681f686c330',
                    data: {
                      adserver: {
                        name: 'gam',
                        adslot: '/19968336/header-bid-tag-1',
                      },
                      pbadslot: '/19968336/header-bid-tag-1',
                    },
                    gpid: '/19968336/header-bid-tag-1',
                  },
                },
                mediaTypes: {
                  banner: {
                    sizes: [
                      [728, 90],
                      [970, 250],
                    ],
                  },
                },
                adUnitCode: '/19968336/header-bid-tag-1',
                transactionId: 'abab4423-d962-41aa-adc7-0681f686c330',
                sizes: [
                  [728, 90],
                  [970, 250],
                ],
                bidId: '21ad295f40dd7ab',
                bidderRequestId: '196b58215c10dc9',
                auctionId,
                src: 'client',
                bidRequestsCount: 1,
                bidderRequestsCount: 1,
                bidderWinsCount: 0,
                ortb2: {
                  site: {
                    page: 'https://site.example.com/pb.html',
                    domain: 'site.example.com',
                    publisher: {
                      domain: 'site.example.com',
                    },
                  },
                  device: {
                    w: 594,
                    h: 976,
                    dnt: 0,
                    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36',
                    language: 'en',
                    sua: {
                      source: 2,
                      platform: {
                        brand: 'macOS',
                        version: ['13', '2', '1'],
                      },
                      browsers: [
                        {
                          brand: 'Google Chrome',
                          version: ['111', '0', '5563', '110'],
                        },
                        {
                          brand: 'Not(A:Brand',
                          version: ['8', '0', '0', '0'],
                        },
                        {
                          brand: 'Chromium',
                          version: ['111', '0', '5563', '110'],
                        },
                      ],
                      mobile: 0,
                      model: '',
                      bitness: '64',
                      architecture: 'arm',
                    },
                  },
                },
              },
              {
                bidder: 'bidder0',
                params: {
                  placement_id: 20216405,
                },
                userId: {
                  '33acrossId': {
                    envelope:
                      'v1.0014',
                  },
                },
                userIdAsEids: [
                  {
                    source: '33across.com',
                    uids: [
                      {
                        id: 'v1.0014',
                        atype: 1,
                      },
                    ],
                  },
                ],
                crumbs: {
                  pubcid: 'badbbf35-1573-47c5-948e-70a63f9271f4',
                },
                ortb2Imp: {
                  ext: {
                    tid: 'b43e7487-0a52-4689-a0f7-d139d08b1f9f',
                    data: {
                      adserver: {
                        name: 'gam',
                        adslot: '/17118521/header-bid-tag-2',
                      },
                      pbadslot: '/17118521/header-bid-tag-2',
                    },
                    gpid: '/17118521/header-bid-tag-2',
                  },
                },
                mediaTypes: {
                  banner: {
                    sizes: [[300, 250]],
                  },
                },
                adUnitCode: '/17118521/header-bid-tag-2',
                transactionId: 'b43e7487-0a52-4689-a0f7-d139d08b1f9f',
                sizes: [[300, 250]],
                bidId: '22108ac7b778717',
                bidderRequestId: '196b58215c10dc9',
                auctionId,
                src: 'client',
                bidRequestsCount: 1,
                bidderRequestsCount: 1,
                bidderWinsCount: 0,
                ortb2: {
                  site: {
                    page: 'https://site.example.com/pb.html',
                    domain: 'site.example.com',
                    publisher: {
                      domain: 'site.example.com',
                    },
                  },
                  device: {
                    w: 594,
                    h: 976,
                    dnt: 0,
                    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36',
                    language: 'en',
                    sua: {
                      source: 2,
                      platform: {
                        brand: 'macOS',
                        version: ['13', '2', '1'],
                      },
                      browsers: [
                        {
                          brand: 'Google Chrome',
                          version: ['111', '0', '5563', '110'],
                        },
                        {
                          brand: 'Not(A:Brand',
                          version: ['8', '0', '0', '0'],
                        },
                        {
                          brand: 'Chromium',
                          version: ['111', '0', '5563', '110'],
                        },
                      ],
                      mobile: 0,
                      model: '',
                      bitness: '64',
                      architecture: 'arm',
                    },
                  },
                },
              },
            ],
            auctionStart: 1680279732944,
            timeout: 3000,
            refererInfo: {
              reachedTop: true,
              isAmp: false,
              numIframes: 0,
              stack: ['https://site.example.com/pb.html'],
              topmostLocation: 'https://site.example.com/pb.html',
              location: 'https://site.example.com/pb.html',
              canonicalUrl: null,
              page: 'https://site.example.com/pb.html',
              domain: 'site.example.com',
              ref: null,
              legacy: {
                reachedTop: true,
                isAmp: false,
                numIframes: 0,
                stack: ['https://site.example.com/pb.html'],
                referer: 'https://site.example.com/pb.html',
                canonicalUrl: null,
              },
            },
            ortb2: {
              site: {
                page: 'https://site.example.com/pb.html',
                domain: 'site.example.com',
                publisher: {
                  domain: 'site.example.com',
                },
              },
              device: {
                w: 594,
                h: 976,
                dnt: 0,
                ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36',
                language: 'en',
                sua: {
                  source: 2,
                  platform: {
                    brand: 'macOS',
                    version: ['13', '2', '1'],
                  },
                  browsers: [
                    {
                      brand: 'Google Chrome',
                      version: ['111', '0', '5563', '110'],
                    },
                    {
                      brand: 'Not(A:Brand',
                      version: ['8', '0', '0', '0'],
                    },
                    {
                      brand: 'Chromium',
                      version: ['111', '0', '5563', '110'],
                    },
                  ],
                  mobile: 0,
                  model: '',
                  bitness: '64',
                  architecture: 'arm',
                },
              },
            },
            start: 1680279732963,
          }
        ],
        noBids: [],
        bidsReceived: [],
        bidsRejected: [],
        winningBids: [],
        timeout: 3000,
        seatNonBids: [],
        config: {
          publisherId: '1001',
        },
      },
      BID_RESPONSE: [{
        bidderCode: 'bidder0',
        width: 300,
        height: 250,
        statusMessage: 'Bid available',
        adId: '123456789abcdef',
        requestId: '20661fc5fbb5d9b',
        transactionId: 'ef947609-7b55-4420-8407-599760d0e373',
        auctionId,
        mediaType: 'banner',
        source: 'client',
        cpm: 1.5,
        creativeId: 96846035,
        currency: 'USD',
        netRevenue: true,
        ttl: 300,
        adUnitCode: '/19968336/header-bid-tag-0',
        bidder0: {
          buyerMemberId: 1234,
        },
        ad,
        adapterCode: 'bidder0',
        originalCpm: 1.5,
        originalCurrency: 'USD',
        floorData: {
          cpmAfterAdjustments: 1
        },
        bidder: 'bidder0',
        timeToRespond: 341,
        pbLg: '1.50',
        pbMg: '1.50',
        pbHg: '1.50',
        pbAg: '1.50',
        pbDg: '1.50',
        pbCg: '',
        size: '300x250',
        status: 'rendered',
        params: [
          {
            placementId: 12345678,
          },
        ],
      },
      {
        bidderCode: 'bidder0',
        width: 728,
        height: 90,
        statusMessage: 'Bid available',
        adId: '3969aa0dc284f9e',
        requestId: '21ad295f40dd7ab',
        transactionId: 'abab4423-d962-41aa-adc7-0681f686c330',
        auctionId,
        mediaType: 'banner',
        source: 'client',
        cpm: 1.5,
        creativeId: 98476543,
        currency: 'USD',
        netRevenue: true,
        ttl: 300,
        adUnitCode: '/19968336/header-bid-tag-1',
        bidder0: {
          buyerMemberId: 1234,
        },
        ad,
        adapterCode: 'bidder0',
        originalCpm: 1.5,
        originalCurrency: 'USD',
        floorData: {
          cpmAfterAdjustments: 1
        },
        responseTimestamp: 1680279733305,
        requestTimestamp: 1680279732963,
        bidder: 'bidder0',
        timeToRespond: 342,
        pbLg: '1.50',
        pbMg: '1.50',
        pbHg: '1.50',
        pbAg: '1.50',
        pbDg: '1.50',
        pbCg: '',
        size: '728x90',
        status: 'targetingSet',
      }],
      BID_WON: [{
        bidderCode: 'bidder0',
        width: 300,
        height: 250,
        statusMessage: 'Bid available',
        adId: '123456789abcdef',
        requestId: '20661fc5fbb5d9b',
        transactionId: 'ef947609-7b55-4420-8407-599760d0e373',
        auctionId,
        mediaType: 'banner',
        source: 'client',
        cpm: 1.5,
        creativeId: 96846035,
        currency: 'USD',
        netRevenue: true,
        ttl: 300,
        adUnitCode: '/19968336/header-bid-tag-0',
        bidder0: {
          buyerMemberId: 1234,
        },
        ad,
        adapterCode: 'bidder0',
        originalCpm: 1.5,
        originalCurrency: 'USD',
        floorData: {
          cpmAfterAdjustments: 1
        },
        responseTimestamp: 1680279733304,
        requestTimestamp: 1680279732963,
        bidder: 'bidder0',
        timeToRespond: 341,
        pbLg: '1.50',
        pbMg: '1.50',
        pbHg: '1.50',
        pbAg: '1.50',
        pbDg: '1.50',
        pbCg: '',
        size: '300x250',
        adserverTargeting: {
          bidder: 'bidder0',
          hb_adid: '123456789abcdef',
          hb_pb: '1.50',
          hb_size: '300x250',
          hb_source: 'client',
          hb_format: 'banner',
          hb_adomain: '',
          hb_acat: '',
        },
        status: 'rendered',
        params: [
          {
            placementId: 12345678,
          },
        ],
      },
      {
        bidderCode: 'bidder0',
        width: 728,
        height: 90,
        statusMessage: 'Bid available',
        adId: '3969aa0dc284f9e',
        requestId: '21ad295f40dd7ab',
        transactionId: 'abab4423-d962-41aa-adc7-0681f686c330',
        auctionId,
        mediaType: 'banner',
        source: 'client',
        cpm: 1.5,
        creativeId: 98476543,
        currency: 'USD',
        netRevenue: true,
        ttl: 300,
        adUnitCode: '/19968336/header-bid-tag-1',
        bidder0: {
          buyerMemberId: 1234,
        },
        ad,
        adapterCode: 'bidder0',
        originalCpm: 1.5,
        originalCurrency: 'USD',
        floorData: {
          cpmAfterAdjustments: 1
        },
        responseTimestamp: 1680279733304,
        requestTimestamp: 1680279732963,
        bidder: 'bidder0',
        timeToRespond: 342,
        pbLg: '1.50',
        pbMg: '1.50',
        pbHg: '1.50',
        pbAg: '1.50',
        pbDg: '1.50',
        pbCg: '',
        size: '728x90',
        adserverTargeting: {
          bidder: 'bidder0',
          hb_adid: '3969aa0dc284f9e',
          hb_pb: '1.50',
          hb_size: '728x90',
          hb_source: 'client',
          hb_format: 'banner',
          hb_adomain: '',
          hb_acat: '',
        },
        status: 'rendered',
        params: [
          {
            placementId: 12345678,
          },
        ],
      },
      {
        bidderCode: 'bidder0',
        width: 300,
        height: 250,
        statusMessage: 'Bid available',
        adId: '3969aa0dc284f9e',
        requestId: '15bef0b1fd2b2e',
        transactionId: 'b43e7487-0a52-4689-a0f7-d139d08b1f9f',
        auctionId,
        mediaType: 'banner',
        source: 'client',
        cpm: 1.5,
        creativeId: 98476543,
        currency: 'USD',
        netRevenue: true,
        ttl: 300,
        adUnitCode: '/17118521/header-bid-tag-2',
        bidder0: {
          buyerMemberId: 1234,
        },
        ad,
        adapterCode: 'bidder0',
        originalCpm: 1.5,
        originalCurrency: 'USD',
        floorData: {
          cpmAfterAdjustments: 1
        },
        responseTimestamp: 1680279733305,
        requestTimestamp: 1680279732963,
        bidder: 'bidder0',
        timeToRespond: 342,
        pbLg: '1.50',
        pbMg: '1.50',
        pbHg: '1.50',
        pbAg: '1.50',
        pbDg: '1.50',
        pbCg: '',
        size: '728x90',
        status: 'targetingSet',
      }],
      AUCTION_END: {
        auctionId,
        timestamp: 1680279732944,
        auctionEnd: 1680279733675,
        auctionStatus: 'completed',
        adUnits: [
          {
            code: '/19968336/header-bid-tag-0',
            mediaTypes: {
              banner: {
                sizes: [
                  [300, 250],
                  [300, 600],
                ],
              },
            },
            bids: [
              {
                bidder: 'bidder0',
                params: {
                  placementId: 12345678,
                },
                userId: {
                  '33acrossId': {
                    envelope:
                      'v1.0014',
                  },
                },
                userIdAsEids: [
                  {
                    source: '33across.com',
                    uids: [
                      {
                        id: 'v1.0014',
                        atype: 1,
                      },
                    ],
                  },
                ],
                crumbs: {
                  pubcid: 'badbbf35-1573-47c5-948e-70a63f9271f4',
                },
              },
            ],
            sizes: [
              [300, 250],
              [300, 600],
            ],
            transactionId: 'ef947609-7b55-4420-8407-599760d0e373',
            ortb2Imp: {
              ext: {
                tid: 'ef947609-7b55-4420-8407-599760d0e373',
                data: {
                  adserver: {
                    name: 'gam',
                    adslot: '/19968336/header-bid-tag-0',
                  },
                  pbadslot: '/19968336/header-bid-tag-0',
                },
                gpid: '/19968336/header-bid-tag-0',
              },
            },
          },
          {
            code: '/19968336/header-bid-tag-1',
            mediaTypes: {
              banner: {
                sizes: [
                  [728, 90],
                  [970, 250],
                ],
              },
            },
            bids: [
              {
                bidder: 'bidder0',
                params: {
                  placementId: 12345678,
                },
                userId: {
                  '33acrossId': {
                    envelope:
                      'v1.0014',
                  },
                },
                userIdAsEids: [
                  {
                    source: '33across.com',
                    uids: [
                      {
                        id: 'v1.0014',
                        atype: 1,
                      },
                    ],
                  },
                ],
                crumbs: {
                  pubcid: 'badbbf35-1573-47c5-948e-70a63f9271f4',
                },
              },
            ],
            sizes: [
              [728, 90],
              [970, 250],
            ],
            transactionId: 'abab4423-d962-41aa-adc7-0681f686c330',
            ortb2Imp: {
              ext: {
                tid: 'abab4423-d962-41aa-adc7-0681f686c330',
                data: {
                  adserver: {
                    name: 'gam',
                    adslot: '/19968336/header-bid-tag-1',
                  },
                  pbadslot: '/19968336/header-bid-tag-1',
                },
                gpid: '/19968336/header-bid-tag-1',
              },
            },
          },
          {
            code: '/17118521/header-bid-tag-2',
            mediaTypes: {
              banner: {
                sizes: [[300, 250]],
              },
            },
            floors: {
              currency: 'USD',
              schema: {
                delimiter: '|',
                fields: ['mediaType', 'size'],
              },
              values: {
                'banner|300x250': 0.01,
              },
            },
            bids: [
              {
                bidder: '33across',
                params: {
                  siteId: 'dukr5O4SWr6iygaKkGJozW',
                  productId: 'siab',
                },
                userId: {
                  '33acrossId': {
                    envelope:
                      'v1.0014',
                  },
                },
                userIdAsEids: [
                  {
                    source: '33across.com',
                    uids: [
                      {
                        id: 'v1.0014',
                        atype: 1,
                      },
                    ],
                  },
                ],
                crumbs: {
                  pubcid: 'badbbf35-1573-47c5-948e-70a63f9271f4',
                },
              },
              {
                bidder: 'bidder0',
                params: {
                  placementId: 20216405,
                },
                userId: {
                  '33acrossId': {
                    envelope:
                      'v1.0014',
                  },
                },
                userIdAsEids: [
                  {
                    source: '33across.com',
                    uids: [
                      {
                        id: 'v1.0014',
                        atype: 1,
                      },
                    ],
                  },
                ],
                crumbs: {
                  pubcid: 'badbbf35-1573-47c5-948e-70a63f9271f4',
                },
              },
            ],
            sizes: [[300, 250]],
            transactionId: 'b43e7487-0a52-4689-a0f7-d139d08b1f9f',
            ortb2Imp: {
              ext: {
                tid: 'b43e7487-0a52-4689-a0f7-d139d08b1f9f',
                data: {
                  adserver: {
                    name: 'gam',
                    adslot: '/17118521/header-bid-tag-2',
                  },
                  pbadslot: '/17118521/header-bid-tag-2',
                },
                gpid: '/17118521/header-bid-tag-2',
              },
            },
          },
        ],
        adUnitCodes: [
          '/19968336/header-bid-tag-0',
          '/19968336/header-bid-tag-1',
          '/17118521/header-bid-tag-2',
        ],
        bidderRequests: [
          {
            bidderCode: 'bidder0',
            auctionId,
            bidderRequestId: '196b58215c10dc9',
            bids: [
              {
                bidder: 'bidder0',
                params: {
                  placement_id: 12345678,
                },
                userId: {
                  '33acrossId': {
                    envelope:
                      'v1.0014',
                  },
                },
                userIdAsEids: [
                  {
                    source: '33across.com',
                    uids: [
                      {
                        id: 'v1.0014',
                        atype: 1,
                      },
                    ],
                  },
                ],
                crumbs: {
                  pubcid: 'badbbf35-1573-47c5-948e-70a63f9271f4',
                },
                ortb2Imp: {
                  ext: {
                    tid: 'ef947609-7b55-4420-8407-599760d0e373',
                    data: {
                      adserver: {
                        name: 'gam',
                        adslot: '/19968336/header-bid-tag-0',
                      },
                      pbadslot: '/19968336/header-bid-tag-0',
                    },
                    gpid: '/19968336/header-bid-tag-0',
                  },
                },
                mediaTypes: {
                  banner: {
                    sizes: [
                      [300, 250],
                      [300, 600],
                    ],
                  },
                },
                adUnitCode: '/19968336/header-bid-tag-0',
                transactionId: 'ef947609-7b55-4420-8407-599760d0e373',
                sizes: [
                  [300, 250],
                  [300, 600],
                ],
                bidId: '20661fc5fbb5d9b',
                bidderRequestId: '196b58215c10dc9',
                auctionId,
                src: 'client',
                bidRequestsCount: 1,
                bidderRequestsCount: 1,
                bidderWinsCount: 0,
                ortb2: {
                  site: {
                    page: 'https://site.example.com/pb.html',
                    domain: 'site.example.com',
                    publisher: {
                      domain: 'site.example.com',
                    },
                  },
                  device: {
                    w: 594,
                    h: 976,
                    dnt: 0,
                    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36',
                    language: 'en',
                    sua: {
                      source: 2,
                      platform: {
                        brand: 'macOS',
                        version: ['13', '2', '1'],
                      },
                      browsers: [
                        {
                          brand: 'Google Chrome',
                          version: ['111', '0', '5563', '110'],
                        },
                        {
                          brand: 'Not(A:Brand',
                          version: ['8', '0', '0', '0'],
                        },
                        {
                          brand: 'Chromium',
                          version: ['111', '0', '5563', '110'],
                        },
                      ],
                      mobile: 0,
                      model: '',
                      bitness: '64',
                      architecture: 'arm',
                    },
                  },
                },
              },
              {
                bidder: 'bidder0',
                params: {
                  placement_id: 12345678,
                },
                userId: {
                  '33acrossId': {
                    envelope:
                      'v1.0014',
                  },
                },
                userIdAsEids: [
                  {
                    source: '33across.com',
                    uids: [
                      {
                        id: 'v1.0014',
                        atype: 1,
                      },
                    ],
                  },
                ],
                crumbs: {
                  pubcid: 'badbbf35-1573-47c5-948e-70a63f9271f4',
                },
                ortb2Imp: {
                  ext: {
                    tid: 'abab4423-d962-41aa-adc7-0681f686c330',
                    data: {
                      adserver: {
                        name: 'gam',
                        adslot: '/19968336/header-bid-tag-1',
                      },
                      pbadslot: '/19968336/header-bid-tag-1',
                    },
                    gpid: '/19968336/header-bid-tag-1',
                  },
                },
                mediaTypes: {
                  banner: {
                    sizes: [
                      [728, 90],
                      [970, 250],
                    ],
                  },
                },
                adUnitCode: '/19968336/header-bid-tag-1',
                transactionId: 'abab4423-d962-41aa-adc7-0681f686c330',
                sizes: [
                  [728, 90],
                  [970, 250],
                ],
                bidId: '21ad295f40dd7ab',
                bidderRequestId: '196b58215c10dc9',
                auctionId,
                src: 'client',
                bidRequestsCount: 1,
                bidderRequestsCount: 1,
                bidderWinsCount: 0,
                ortb2: {
                  site: {
                    page: 'https://site.example.com/pb.html',
                    domain: 'site.example.com',
                    publisher: {
                      domain: 'site.example.com',
                    },
                  },
                  device: {
                    w: 594,
                    h: 976,
                    dnt: 0,
                    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36',
                    language: 'en',
                    sua: {
                      source: 2,
                      platform: {
                        brand: 'macOS',
                        version: ['13', '2', '1'],
                      },
                      browsers: [
                        {
                          brand: 'Google Chrome',
                          version: ['111', '0', '5563', '110'],
                        },
                        {
                          brand: 'Not(A:Brand',
                          version: ['8', '0', '0', '0'],
                        },
                        {
                          brand: 'Chromium',
                          version: ['111', '0', '5563', '110'],
                        },
                      ],
                      mobile: 0,
                      model: '',
                      bitness: '64',
                      architecture: 'arm',
                    },
                  },
                },
              },
              {
                bidder: 'bidder0',
                params: {
                  placement_id: 20216405,
                },
                userId: {
                  '33acrossId': {
                    envelope:
                      'v1.0014',
                  },
                },
                userIdAsEids: [
                  {
                    source: '33across.com',
                    uids: [
                      {
                        id: 'v1.0014',
                        atype: 1,
                      },
                    ],
                  },
                ],
                crumbs: {
                  pubcid: 'badbbf35-1573-47c5-948e-70a63f9271f4',
                },
                ortb2Imp: {
                  ext: {
                    tid: 'b43e7487-0a52-4689-a0f7-d139d08b1f9f',
                    data: {
                      adserver: {
                        name: 'gam',
                        adslot: '/17118521/header-bid-tag-2',
                      },
                      pbadslot: '/17118521/header-bid-tag-2',
                    },
                    gpid: '/17118521/header-bid-tag-2',
                  },
                },
                mediaTypes: {
                  banner: {
                    sizes: [[300, 250]],
                  },
                },
                adUnitCode: '/17118521/header-bid-tag-2',
                transactionId: 'b43e7487-0a52-4689-a0f7-d139d08b1f9f',
                sizes: [[300, 250]],
                bidId: '22108ac7b778717',
                bidderRequestId: '196b58215c10dc9',
                auctionId,
                src: 'client',
                bidRequestsCount: 1,
                bidderRequestsCount: 1,
                bidderWinsCount: 0,
                ortb2: {
                  site: {
                    page: 'https://site.example.com/pb.html',
                    domain: 'site.example.com',
                    publisher: {
                      domain: 'site.example.com',
                    },
                  },
                  device: {
                    w: 594,
                    h: 976,
                    dnt: 0,
                    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36',
                    language: 'en',
                    sua: {
                      source: 2,
                      platform: {
                        brand: 'macOS',
                        version: ['13', '2', '1'],
                      },
                      browsers: [
                        {
                          brand: 'Google Chrome',
                          version: ['111', '0', '5563', '110'],
                        },
                        {
                          brand: 'Not(A:Brand',
                          version: ['8', '0', '0', '0'],
                        },
                        {
                          brand: 'Chromium',
                          version: ['111', '0', '5563', '110'],
                        },
                      ],
                      mobile: 0,
                      model: '',
                      bitness: '64',
                      architecture: 'arm',
                    },
                  },
                },
              },
            ],
            auctionStart: 1680279732944,
            timeout: 3000,
            refererInfo: {
              reachedTop: true,
              isAmp: false,
              numIframes: 0,
              stack: ['https://site.example.com/pb.html'],
              topmostLocation: 'https://site.example.com/pb.html',
              location: 'https://site.example.com/pb.html',
              canonicalUrl: null,
              page: 'https://site.example.com/pb.html',
              domain: 'site.example.com',
              ref: null,
              legacy: {
                reachedTop: true,
                isAmp: false,
                numIframes: 0,
                stack: ['https://site.example.com/pb.html'],
                referer: 'https://site.example.com/pb.html',
                canonicalUrl: null,
              },
            },
            ortb2: {
              site: {
                page: 'https://site.example.com/pb.html',
                domain: 'site.example.com',
                publisher: {
                  domain: 'site.example.com',
                },
              },
              device: {
                w: 594,
                h: 976,
                dnt: 0,
                ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36',
                language: 'en',
                sua: {
                  source: 2,
                  platform: {
                    brand: 'macOS',
                    version: ['13', '2', '1'],
                  },
                  browsers: [
                    {
                      brand: 'Google Chrome',
                      version: ['111', '0', '5563', '110'],
                    },
                    {
                      brand: 'Not(A:Brand',
                      version: ['8', '0', '0', '0'],
                    },
                    {
                      brand: 'Chromium',
                      version: ['111', '0', '5563', '110'],
                    },
                  ],
                  mobile: 0,
                  model: '',
                  bitness: '64',
                  architecture: 'arm',
                },
              },
            },
            start: 1680279732963,
          }
        ],
        noBids: [ /* no need to populate */ ],
        bidsReceived: [
          {
            bidderCode: 'bidder0',
            width: 300,
            height: 250,
            statusMessage: 'Bid available',
            adId: '123456789abcdef',
            requestId: '20661fc5fbb5d9b',
            transactionId: 'ef947609-7b55-4420-8407-599760d0e373',
            auctionId,
            mediaType: 'banner',
            source: 'client',
            cpm: 1.5,
            creativeId: 96846035,
            currency: 'USD',
            netRevenue: true,
            ttl: 300,
            adUnitCode: '/19968336/header-bid-tag-0',
            bidder0: {
              buyerMemberId: 1234,
            },
            ad,
            adapterCode: 'bidder0',
            originalCpm: 1.5,
            originalCurrency: 'USD',
            floorData: {
              cpmAfterAdjustments: 1
            },
            bidder: 'bidder0',
            timeToRespond: 341,
            pbLg: '1.50',
            pbMg: '1.50',
            pbHg: '1.50',
            pbAg: '1.50',
            pbDg: '1.50',
            pbCg: '',
            size: '300x250',
            status: 'rendered',
            params: [
              {
                placementId: 12345678,
              },
            ],
          },
          {
            bidderCode: 'bidder0',
            width: 728,
            height: 90,
            statusMessage: 'Bid available',
            adId: '3969aa0dc284f9e',
            requestId: '21ad295f40dd7ab',
            transactionId: 'abab4423-d962-41aa-adc7-0681f686c330',
            auctionId,
            mediaType: 'banner',
            source: 'client',
            cpm: 1.5,
            creativeId: 98476543,
            currency: 'USD',
            netRevenue: true,
            ttl: 300,
            adUnitCode: '/19968336/header-bid-tag-1',
            bidder0: {
              buyerMemberId: 1234,
            },
            ad,
            adapterCode: 'bidder0',
            originalCpm: 1.5,
            originalCurrency: 'USD',
            floorData: {
              cpmAfterAdjustments: 1
            },
            responseTimestamp: 1680279733305,
            requestTimestamp: 1680279732963,
            bidder: 'bidder0',
            timeToRespond: 342,
            pbLg: '1.50',
            pbMg: '1.50',
            pbHg: '1.50',
            pbAg: '1.50',
            pbDg: '1.50',
            pbCg: '',
            size: '728x90',
            status: 'targetingSet',
          },
        ],
        bidsRejected: [],
        winningBids: [],
        timeout: 3000,
        seatNonBids: [],
      },
    }]
  };
}
