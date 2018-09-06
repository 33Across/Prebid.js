import { userSync } from 'src/userSync';
import * as utils from 'src/utils';

const { registerBidder } = require('../src/adapters/bidderFactory');
const { config } = require('../src/config');

const BIDDER_CODE = '33across';
const END_POINT = 'https://ssc.33across.com/api/v1/hb';
const SYNC_ENDPOINT = 'https://de.tynt.com/deb/v2?m=xch&rt=html';

// All this assumes that only one bid is ever returned by ttx
function _createBidResponse(response) {
  return {
    requestId: response.id,
    bidderCode: BIDDER_CODE,
    cpm: response.seatbid[0].bid[0].price,
    width: response.seatbid[0].bid[0].w,
    height: response.seatbid[0].bid[0].h,
    ad: response.seatbid[0].bid[0].adm,
    ttl: response.seatbid[0].bid[0].ttl || 60,
    creativeId: response.seatbid[0].bid[0].crid,
    currency: response.cur,
    netRevenue: true
  }
}

// infer the necessary data from valid bid for a minimal ttxRequest and create HTTP request
function _createServerRequest(bidRequest) {
  const ttxRequest = {};
  const params = bidRequest.params;
  const element = document.getElementById(bidRequest.adUnitCode);
  const sizes = transformSizes(bidRequest.sizes);
  const minSize = getMinSize(sizes);

  const contributeViewability = ViewabilityContributor(
    getPercentInView(element, window.top, minSize)
  );

  /*
   * Infer data for the request payload
   */
  ttxRequest.imp = [];
  ttxRequest.imp[0] = {
    banner: {
      format: Object.assign({ext: {}}, sizes)
    },
    ext: {
      ttx: {
        prod: params.productId
      }
    }
  };
  ttxRequest.site = { id: params.siteId };
  // Go ahead send the bidId in request to 33exchange so it's kept track of in the bid response and
  // therefore in ad targetting process
  ttxRequest.id = bidRequest.bidId;
  // Finally, set the openRTB 'test' param if this is to be a test bid
  if (params.test === 1) {
    ttxRequest.test = 1;
  }

  /*
   * Now construt the full server request
   */
  const options = {
    contentType: 'application/json',
    withCredentials: true
  };
  // Allow the ability to configure the HB endpoint for testing purposes.
  const ttxSettings = config.getConfig('ttxSettings');
  const url = (ttxSettings && ttxSettings.url) || END_POINT;

  console.warn('_createServerRequest(), ttxRequest.imp[0].banner:', JSON.stringify(ttxRequest.imp[0].banner));
  console.warn('_createServerRequest(), with viewability:', JSON.stringify(contributeViewability(ttxRequest).imp[0].banner));

  // Return the server request
  return {
    'method': 'POST',
    'url': url,
    'data': JSON.stringify(contributeViewability(ttxRequest)),
    'options': options
  }
}

function transformSizes(sizes) {
  if (utils.isArray(sizes) && sizes.length === 2 && !utils.isArray(sizes[0])) {
    return [getSize(sizes)];
  }

  return sizes.map(getSize);
}

function getSize(size) {
  return {
    w: parseInt(size[0], 10),
    h: parseInt(size[1], 10)
  }
}

function getMinSize(sizes) {
  return sizes.reduce((min, size) => size.h * size.w < min.h * min.w ? size : min);
}

function getIntersectionOfRects(rects) {
  console.warn('getIntersectionOfRects.getIntersectionOfRects():', rects);

  const bbox = {
    left: rects[0].left,
    right: rects[0].right,
    top: rects[0].top,
    bottom: rects[0].bottom
  };

  for (let i = 1; i < rects.length; ++i) {
    bbox.left = Math.max(bbox.left, rects[i].left);
    bbox.right = Math.min(bbox.right, rects[i].right);

    if (bbox.left >= bbox.right) {
      return null;
    }

    bbox.top = Math.max(bbox.top, rects[i].top);
    bbox.bottom = Math.min(bbox.bottom, rects[i].bottom);

    if (bbox.top >= bbox.bottom) {
      return null;
    }
  }

  bbox.width = bbox.right - bbox.left;
  bbox.height = bbox.bottom - bbox.top;

  return bbox;
}

function getPercentInView(element, topWin, { w, h } = {}) {
  let elementInViewArea, elementTotalArea;
  let elementBoundingBox, elementInViewBoundingBox;
  let { width, height, left, top, right, bottom } = element.getBoundingClientRect();

  if ((width === 0 || height === 0) && w && h) {
    console.warn('getBoundingBox(): using ad size for calculation');
    width = w;
    height = h;
    right = left + w;
    bottom = top + h;
  }

  elementBoundingBox = { width, height, left, top, right, bottom };

  // Obtain the intersection of the element and the viewport
  elementInViewBoundingBox = getIntersectionOfRects([{
    left: 0,
    top: 0,
    right: topWin.innerWidth,
    bottom: topWin.innerHeight
  }, elementBoundingBox]);

  if (elementInViewBoundingBox !== null) {
    // Some or all of the element is in view
    elementInViewArea = elementInViewBoundingBox.width * elementInViewBoundingBox.height;
    elementTotalArea = elementBoundingBox.width * elementBoundingBox.height;

    return ((elementInViewArea / elementTotalArea) * 100);
  }

  // No overlap between element and the viewport; therefore, the element
  // lies completely out of view
  return 0;
}

/**
 * Viewability contribution to request..
 */
function ViewabilityContributor(viewabilityAmount) {
  function contributeViewability(ttxRequest) {
    const req = Object.assign({}, ttxRequest);
    const imp = req.imp = req.imp.map(impItem => Object.assign({}, impItem));
    const banner = imp[0].banner = Object.assign({}, imp[0].banner);
    const ext = banner.ext = Object.assign({}, banner.ext);
    const ttx = ext.ttx = Object.assign({}, ext.ttx);

    ttx.viewability = { amount: Math.round(viewabilityAmount) };

    return req;
  }

  return contributeViewability;
}

// Register one sync per bid since each ad unit may potenitally be linked to a uniqe guid
// Sync type will always be 'iframe' for 33Across
function _registerUserSyncs(requestData) {
  let ttxRequest;
  try {
    ttxRequest = JSON.parse(requestData);
  } catch (err) {
    // No point in trying to register sync since the requisite data cannot be parsed.
    return;
  }
  const ttxSettings = config.getConfig('ttxSettings');

  let syncUrl = (ttxSettings && ttxSettings.syncUrl) || SYNC_ENDPOINT;

  syncUrl = `${syncUrl}&id=${ttxRequest.site.id}`;
  userSync.registerSync('iframe', BIDDER_CODE, syncUrl);
}

function isBidRequestValid(bid) {
  if (bid.bidder !== BIDDER_CODE || typeof bid.params === 'undefined') {
    return false;
  }

  if (typeof bid.params.siteId === 'undefined' || typeof bid.params.productId === 'undefined') {
    return false;
  }

  return true;
}

// NOTE: At this point, 33exchange only accepts request for a single impression
function buildRequests(bidRequests) {
  return bidRequests.map(_createServerRequest);
}

// NOTE: At this point, the response from 33exchange will only ever contain one bid i.e. the highest bid
function interpretResponse(serverResponse, bidRequest) {
  // Register user sync first
  if (bidRequest && bidRequest.data) {
    _registerUserSyncs(bidRequest.data);
  }

  const bidResponses = [];

  // If there are bids, look at the first bid of the first seatbid (see NOTE above for assumption about ttx)
  if (serverResponse.body.seatbid.length > 0 && serverResponse.body.seatbid[0].bid.length > 0) {
    bidResponses.push(_createBidResponse(serverResponse.body));
  }

  return bidResponses;
}

const spec = {
  code: BIDDER_CODE,
  isBidRequestValid,
  buildRequests,
  interpretResponse
};

registerBidder(spec);

module.exports = spec;
