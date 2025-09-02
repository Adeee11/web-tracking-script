(() => {
  var pageInfo = {};
  var events = [];
  var script = document.currentScript;
  var siteId = script.getAttribute("data-site");
  var excludeDomains = script.getAttribute("data-exclude-domains");
  var pageInfo = {};

  function isTrackingEnabled() {
    const { hostname, pathname } = window.location;
    return pathname && hostname && siteId && !excludeDomains.includes(hostname);
  }

  function sendAnalyticsBeacon(data) {
    if (!isTrackingEnabled()) return;
    if (!data.events || data.events.length === 0) {
      return;
    }
    const events = data.events;
    data.events = encodeURIComponent(JSON.stringify(events));

    data.cid = Math.floor(1e8 * Math.random()) + 1;
    data.sid = siteId;
    const searchParams = new URLSearchParams(data).toString();
    const url = "__BASE_URL__" + "?" + searchParams;

    navigator.sendBeacon(url);
  }

  if (void 0 !== history) {
    const searchParams = new URLSearchParams(window.location.search);
    const searchParamsObj = Object.fromEntries(searchParams);
    pageInfo = {
      host: window.location.hostname,
      path: window.location.pathname,
      ...(document.referrer && { referer: document.referrer }),
      ...searchParamsObj,
    };
    historyBasedTracking();
  } else {
    console.warn(
      "History API not supported. Tracking may not work as expected."
    );
  }

  function historyBasedTracking() {
    if (history) {
      const originalPushState = history.pushState;
      history.pushState = function (...args) {
        const result = originalPushState.apply(history, args);
        window.dispatchEvent(new Event("pushstate"));
        window.dispatchEvent(new Event("location-change"));
        return result;
      };

      window.addEventListener("popstate", () => {
        window.dispatchEvent(new Event("location-change"));
      });

      window.addEventListener("location-change", () => {
        const navigationTiming = performance.getEntriesByType("navigation")[0];
        const timeSpent =
          (performance.now() - navigationTiming.domContentLoadedEventEnd) /
          1000;

        const searchParams = new URLSearchParams(window.location.search);
        const searchParamsObj = Object.fromEntries(searchParams);
        events.push([
          "page_view",
          {
            ...pageInfo,
            timestamp: Date.now(),
            viewport_height: document.documentElement.scrollHeight,
            viewport_width: document.documentElement.clientWidth,
          },
        ]);
        setTimeout(() => sendAnalyticsBeacon({ events: events.slice() }), 0);
        events.length = 0;
        pageInfo = {
          host: window.location.hostname,
          path: window.location.pathname,
          ...(document.referrer && { referer: document.referrer }),
          ...searchParamsObj,
        };
      });
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    let searchParams = new URLSearchParams(window.location.search);
    let searchParamsObj = Object.fromEntries(searchParams);

    pageInfo = {
      host: window.location.hostname,
      path: window.location.pathname,
      ...(document.referrer && { referer: document.referrer }),
      ...searchParamsObj,
    };
  });

  window.addEventListener("beforeunload", function () {
    events.push([
      "page_view",
      {
        ...pageInfo,
        timestamp: Date.now(),
      },
    ]);
    setTimeout(() => sendAnalyticsBeacon({ events: events.slice() }), 0);
    // events.length = 0;
  });
})();
