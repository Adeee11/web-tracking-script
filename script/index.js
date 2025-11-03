(() => {
  var pageInfo = {};
  var events = [];
  var script = document.currentScript;
  var siteId = script.getAttribute("data-site");
  var excludeDomains = script.getAttribute("data-exclude-domains") ?? [];
  var external;
  var attachedHandlers = {
    links: [],
    forms: [],
    downloads: [],
    custom:[]
  };

  var trackFileExtensions = [
    "pdf",
    "xlsx",
    "docx",
    "txt",
    "rtf",
    "csv",
    "exe",
    "key",
    "pps",
    "ppt",
    "pptx",
    "7z",
    "pkg",
    "rar",
    "gz",
    "zip",
    "avi",
    "mov",
    "mp4",
    "mpeg",
    "wmv",
    "midi",
    "mp3",
    "wav",
    "wma",
    "dmg",
  ];

  function isTrackingEnabled() {
    const { hostname, pathname } = window.location;
    return (
      pathname && hostname && siteId && !excludeDomains?.includes(hostname)
    );
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
    const url = "https://track.flooanalytics.com" + "?" + searchParams;

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

  function handleExternalLink() {
    // Remove old handlers
    attachedHandlers.links.forEach(({ element, handler }) => {
      element.removeEventListener("click", handler);
    });
    attachedHandlers.links = [];

    document.querySelectorAll("a").forEach((link) => {
      const handler = function (event) {
        const linkUrl = new URL(
          link.getAttribute("href"),
          window.location.href
        );
        const currentHostname = window.location.hostname;
        if (!linkUrl) return;

        // ignore file downloads
        const fileExtension = linkUrl.pathname.split(".").pop().toLowerCase();
        if (trackFileExtensions.includes(fileExtension)) {
          return;
        }
        // track only external links
        if (
          linkUrl.hostname !== currentHostname &&
          link.href !== undefined &&
          link.href !== "undefined"
        ) {
          event.preventDefault();
          external = linkUrl;
          events.push([
            "external_link",
            {
              external_link: external,
            },
          ]);

          // window.location.href = link.href

          // Check if link should open in a new tab
          if (link.target === "_blank") {
            window.open(link.href, "_blank");
          } else {
            window.location.href = link.href;
          }
        }
      };
      link.addEventListener("click", handler);
      attachedHandlers.links.push({ element: link, handler });
    });
  }

  function handleCustomEventElements() {
  // Remove old handlers
  if (attachedHandlers.custom) {
    attachedHandlers.custom.forEach(({ element, handler }) => {
      element.removeEventListener("click", handler);
    });
  }
  attachedHandlers.custom = [];

  // Match all elements that have floo-event-name=
  document.querySelectorAll("[class*='floo-event-name=']").forEach((el) => {
    // Extract event name (e.g. floo-event-name=Signup+Pro)
    const match = el.className.match(/floo-event-name=([^\s]+)/);
    const eventName = match
      ? decodeURIComponent(match[1].replace(/\+/g, " "))
      : null;

    if (!eventName) return;

    const handler = (event) => {
      // Optional: capture useful props
      const props = {
        text: el.innerText || el.value || null,
        tag: el.tagName.toLowerCase(),
        url: el.href || window.location.href,
      };

      events.push([
        eventName,
        {
          ...pageInfo,
          ...props,
          timestamp: Date.now(),
        },
      ]);

      // Send beacon immediately for custom events
      setTimeout(() => sendAnalyticsBeacon({ events: events.slice() }), 0);
      events.length = 0;
    };

    el.addEventListener("click", handler);
    attachedHandlers.custom.push({ element: el, handler });
  });
}


  function historyBasedTracking() {
    if (history) {
      handleExternalLink();
      handleCustomEventElements()
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
            time_spent: timeSpent ?? 0,
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

    handleExternalLink();
    handleCustomEventElements();

    pageInfo = {
      host: window.location.hostname,
      path: window.location.pathname,
      ...(document.referrer && { referer: document.referrer }),
      ...searchParamsObj,
    };
  });

  window.addEventListener("beforeunload", function () {
    const navigationTiming = performance.getEntriesByType("navigation")[0];
    const timeSpent =
      (performance.now() - navigationTiming.domContentLoadedEventEnd) / 1000;
    events.push([
      "page_view",
      {
        ...pageInfo,
        timestamp: Date.now(),
        time_spent: timeSpent ?? 0,
      },
    ]);
    setTimeout(() => sendAnalyticsBeacon({ events: events.slice() }), 0);
    // events.length = 0;
  });
})();
