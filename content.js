// content.js

// 1. Inject the interceptor into the "Main World"
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
(document.head || document.documentElement).appendChild(script);

let scrappedPosts = [];
let isScrolling = true;
const MAX_POSTS = 15; // Set your limit here

// 2. Listen for messages from the injected script
window.addEventListener("message", (event) => {
    if (event.data.type === "FB_GRAPHQL_DATA") {
        parseAndStore(event.data.payload);
    }
});

function parseAndStore(json) {
    const node = json.data?.node || json.data?.viewer?.news_feed?.edges?.map(e => e.node);
    const edges = json.data?.viewer?.news_feed?.edges || (json.data?.node ? [{node: json.data.node}] : []);

    edges.forEach(edge => {
        const item = edge.node;
        if (!item || item.__typename !== "Story") return;

        const postObj = {
            type: item.th_dat_spo ? "sponsor" : "user",
            story_content: item.comet_sections?.content?.story?.message?.text || item.message?.text || "",
            permanent_link: item.comet_sections?.content?.story?.wwwURL || item.permalink_url || "",
            poster: {
                name: item.actors?.[0]?.name || "Unknown",
                link: item.actors?.[0]?.url || ""
            }
        };

        // Deduplicate by permalink
        if (!scrappedPosts.find(p => p.permanent_link === postObj.permanent_link)) {
            scrappedPosts.push(postObj);
            console.log(`Captured ${scrappedPosts.length}: ${postObj.poster.name}`);
        }
    });

    if (scrappedPosts.length >= MAX_POSTS) {
        stopAndSave();
    }
}

// 3. Automated Scrolling Logic
async function autoScroll() {
    if (!isScrolling) return;

    window.scrollTo(0, document.body.scrollHeight);
    
    // Random delay between 3-5 seconds to avoid detection
    const delay = Math.floor(Math.random() * 2000) + 3000;
    
    setTimeout(() => {
        if (scrappedPosts.length < MAX_POSTS) {
            autoScroll();
        } else {
            stopAndSave();
        }
    }, delay);
}

function stopAndSave() {
    if (!isScrolling) return;
    isScrolling = false;
    console.log("Scrapping Complete. Saving Data...", scrappedPosts);
    
    const blob = new Blob([JSON.stringify(scrappedPosts, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fb_feed_${Date.now()}.json`;
    a.click();
}

// Start scrolling after page load
setTimeout(autoScroll, 3000);