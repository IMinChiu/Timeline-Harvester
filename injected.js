// injected.js
(function() {
    const XHR = XMLHttpRequest.prototype;
    const open = XHR.open;
    const send = XHR.send;

    // Patch 'open' to capture the URL and method
    XHR.open = function(method, url) {
        this._url = url;
        this._method = method;
        return open.apply(this, arguments);
    };

    // Patch 'send' to intercept and debug the payload
    XHR.send = function(postData) {
        // --- DEBUG: LOG OUTGOING REQUESTS ---
        if (this._url && this._url.includes("/api/graphql/")) {
            // Extract the query name from the URL or postData for debugging
            const params = new URLSearchParams(postData);
            const friendlyName = params.get('fb_api_req_friendly_name') || "Unknown Query";
            console.debug(`[GQL-OUT] Sending: ${friendlyName}`);
        }

        this.addEventListener('load', function() {
            if (this._url && this._url.includes("/api/graphql/")) {
                try {
                    const rawResponse = this.responseText;
                    if (!rawResponse) return;

                    // FB uses newline-delimited JSON for streaming responses
                    const lines = rawResponse.split('\n');

                    lines.forEach((line, index) => {
                        const trimmed = line.trim();
                        if (!trimmed) return;

                        let json;
                        try {
                            json = JSON.parse(trimmed);
                        } catch (e) { return; }

                        // --- DEBUG: LOG INCOMING LABELS ---
                        const label = json.label || "No Label";
                        console.debug(`[GQL-IN] Part ${index} | Label: ${label}`);

                        // The filter logic
                        const isTimeline = label.includes("CometNewsFeed") || 
                                           label.includes("CometModernFeedPaginationQuery") ||
                                           label.includes("CometNewsFeed_viewerConnection");

                        if (isTimeline) {
                            console.log(`%c[MATCHED] Captured Timeline Item: ${label}`, "color: #00ff00; font-weight: bold;");
                            window.postMessage({ 
                                source: "fb-interceptor", 
                                type: "FB_GRAPHQL_DATA", 
                                payload: json 
                            }, "*");
                        }
                    });
                } catch (err) {
                    console.error("[Interceptor Error]", err);
                }
            }
        });

        return send.apply(this, arguments);
    };

    console.log("%cFB XHR Interceptor with Debugging Active", "color: #4267B2; font-size: 14px; font-weight: bold;");
})();