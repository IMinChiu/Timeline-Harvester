// content.js

// 1. Inject the interceptor into the "Main World"
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
(document.head || document.documentElement).appendChild(script);

let scrappedPosts = [];
let enhancedPosts = []; // Posts after LLM analysis
let isScrolling = false; // Set to false, don't auto-start
const MAX_POSTS = 10; // Set your limit here
let overlayElement = null;
let isAnalyzing = false; // Track if LLM analysis is in progress
let analysisStatus = 'idle'; // 'idle', 'waiting_for_raw', 'analyzing', 'complete'

// Configuration state
let config = {
    category: '',
    prompt: '',
    llmProvider: 'openai', // 'openai' or 'gemini'
    openai: {
        model: 'gpt-5-mini-2025-08-07',
        apiKey: ''
    },
    gemini: {
        model: 'gemini-pro',
        apiKey: ''
    }
};

// OpenAI models
const OPENAI_MODELS = [
    { value: 'gpt-5-mini-2025-08-07', label: 'GPT-5 Mini' },
    { value: 'gpt-5-nano-2025-08-07', label: 'GPT-5 Nano' }
];

// Gemini models
const GEMINI_MODELS = [
    { value: 'gemini-pro', label: 'Gemini Pro' },
    { value: 'gemini-pro-vision', label: 'Gemini Pro Vision' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' }
];

// Load configuration from storage
async function loadConfig() {
    try {
        const result = await chrome.storage.local.get(['scraperConfig']);
        if (result.scraperConfig) {
            config = { ...config, ...result.scraperConfig };
        }
    } catch (error) {
        console.error('Failed to load config:', error);
    }
}

// Save configuration to storage
async function saveConfig() {
    try {
        await chrome.storage.local.set({ scraperConfig: config });
    } catch (error) {
        console.error('Failed to save config:', error);
    }
}

// Load config on script start
loadConfig();

// 2. Listen for messages from the injected script
window.addEventListener("message", (event) => {
    if (event.data.type === "FB_GRAPHQL_DATA") {
        parseAndStore(event.data.payload);
    }
});

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggleAndStart') {
        // Toggle overlay and start scraping if not already running
        (async () => {
            if (overlayElement) {
                // If overlay is open, just start if not running
                if (!isScrolling) {
                    isScrolling = true;
                    scrappedPosts = []; // Reset data
                    enhancedPosts = []; // Reset enhanced posts
                    analysisStatus = 'waiting_for_raw'; // Set status
                    console.log("Starting scraping...");
                    autoScroll();
                    updateOverlay();
                }
            } else {
                // If overlay is closed, open it and start
                if (!isScrolling) {
                    isScrolling = true;
                    scrappedPosts = []; // Reset data
                    enhancedPosts = []; // Reset enhanced posts
                    analysisStatus = 'waiting_for_raw'; // Set status
                    console.log("Starting scraping...");
                    await showOverlay();
                    autoScroll();
                } else {
                    await showOverlay();
                }
            }
            sendResponse({ success: true, isRunning: isScrolling });
        })();
        return true; // Keep message channel open for async response
    } else if (request.action === 'start') {
        (async () => {
            if (!isScrolling) {
                isScrolling = true;
                scrappedPosts = []; // Reset data
                enhancedPosts = []; // Reset enhanced posts
                analysisStatus = 'waiting_for_raw'; // Set status
                console.log("Starting scraping...");
                await showOverlay();
                autoScroll();
                sendResponse({ success: true, isRunning: true });
            } else {
                sendResponse({ success: false, message: 'Already running' });
            }
        })();
        return true; // Keep message channel open for async response
    } else if (request.action === 'stop') {
        if (isScrolling) {
            isScrolling = false;
            console.log("Stopping scraping");
            updateOverlay();
            sendResponse({ success: true, isRunning: false });
        } else {
            sendResponse({ success: false, message: 'Not running' });
        }
    } else if (request.action === 'toggle') {
        // Toggle overlay visibility
        (async () => {
            if (overlayElement) {
                hideOverlay();
            } else {
                await showOverlay();
            }
            sendResponse({ success: true });
        })();
        return true; // Keep message channel open for async response
    } else if (request.action === 'getStatus') {
        sendResponse({ isRunning: isScrolling });
    }
    return true; // Keep message channel open for async response
});

// Keyboard shortcut to toggle overlay (Ctrl+Shift+H or Cmd+Shift+H)
document.addEventListener('keydown', async (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'H') {
        e.preventDefault();
        if (overlayElement) {
            hideOverlay();
        } else {
            await showOverlay();
        }
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
            updateOverlay();
        }
    });

    if (scrappedPosts.length >= MAX_POSTS) {
        stopAndSave();
        // Trigger LLM analysis
        analyzePostsWithLLM();
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
    
    updateOverlay(); // Final update before saving
    
    const blob = new Blob([JSON.stringify(scrappedPosts, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fb_feed_${Date.now()}.json`;
    a.click();
    
    // Notify popup that status has changed
    chrome.runtime.sendMessage({ type: 'statusChanged', isRunning: false });
}

// Analyze posts with LLM
async function analyzePostsWithLLM() {
    if (isAnalyzing || scrappedPosts.length === 0) return;
    
    // Filter out sponsor/ad posts
    const userPosts = scrappedPosts.filter(post => post.type === 'user');
    if (userPosts.length === 0) {
        analysisStatus = 'complete';
        enhancedPosts = [];
        updateOverlay();
        return;
    }
    
    isAnalyzing = true;
    analysisStatus = 'analyzing';
    updateOverlay();
    
    try {
        await loadConfig();
        
        if (!config.openai.apiKey) {
            console.error('OpenAI API key not configured');
            analysisStatus = 'error';
            isAnalyzing = false;
            updateOverlay();
            return;
        }
        
        // Prepare prompt for LLM
        const postsData = userPosts.map((post, index) => ({
            id: index + 1,
            author: post.poster.name,
            content: post.story_content || '(No content)',
            link: post.permanent_link
        }));
        
        const systemPrompt = `You are analyzing Facebook posts. For each post, provide:
1. A category/tag (e.g., Tech, News, Personal, etc.)
2. A brief summary (2-3 sentences)
3. An importance score (1-10, where 10 is most important)

Return a JSON object with a "posts" array where each object has:
- id: the post id (number)
- category: string
- summary: string
- importance: number (1-10)

Order the results by importance (highest first). The response must be valid JSON with this structure:
{
  "posts": [
    {"id": 1, "category": "...", "summary": "...", "importance": 8},
    ...
  ]
}`;

        const userPrompt = config.prompt 
            ? `${config.prompt}\n\nPosts to analyze:\n${JSON.stringify(postsData, null, 2)}`
            : `Analyze these Facebook posts:\n${JSON.stringify(postsData, null, 2)}`;
        
        // Call OpenAI API
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.openai.apiKey}`
            },
            body: JSON.stringify({
                model: config.openai.model || 'gpt-5-mini-2025-08-07',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                response_format: { type: 'json_object' },
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || 'API request failed');
        }
        
        const data = await response.json();
        const analysisText = data.choices[0]?.message?.content;
        
        if (!analysisText) {
            throw new Error('No response from LLM');
        }
        
        // Parse the JSON response
        let analysisResult;
        try {
            analysisResult = JSON.parse(analysisText);
        } catch (e) {
            // Try to extract JSON from markdown code blocks
            const jsonMatch = analysisText.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
            if (jsonMatch) {
                analysisResult = JSON.parse(jsonMatch[1]);
            } else {
                // Try to find JSON object in the text
                const jsonObjMatch = analysisText.match(/\{[\s\S]*\}/);
                if (jsonObjMatch) {
                    analysisResult = JSON.parse(jsonObjMatch[0]);
                } else {
                    throw new Error('Failed to parse LLM response');
                }
            }
        }
        
        // Map analysis results back to posts
        const analysisMap = {};
        if (Array.isArray(analysisResult)) {
            analysisResult.forEach(item => {
                if (item.id) {
                    analysisMap[item.id] = item;
                }
            });
        } else if (analysisResult.posts && Array.isArray(analysisResult.posts)) {
            analysisResult.posts.forEach(item => {
                if (item.id) {
                    analysisMap[item.id] = item;
                }
            });
        } else if (analysisResult.analysis && Array.isArray(analysisResult.analysis)) {
            analysisResult.analysis.forEach(item => {
                if (item.id) {
                    analysisMap[item.id] = item;
                }
            });
        } else {
            // If it's an object with numeric keys or id-based keys
            Object.keys(analysisResult).forEach(key => {
                const item = analysisResult[key];
                if (item && typeof item === 'object') {
                    if (item.id) {
                        analysisMap[item.id] = item;
                    } else if (!isNaN(key)) {
                        // Numeric key might be the id
                        analysisMap[parseInt(key)] = item;
                    }
                }
            });
        }
        
        // Create enhanced posts
        enhancedPosts = userPosts
            .map((post, index) => {
                const analysis = analysisMap[index + 1] || analysisMap[String(index + 1)] || {};
                return {
                    ...post,
                    category: analysis.category || 'Uncategorized',
                    summary: analysis.summary || 'No summary available',
                    importance: analysis.importance || analysis.score || 5
                };
            })
            .sort((a, b) => (b.importance || 5) - (a.importance || 5)); // Sort by importance
        
        analysisStatus = 'complete';
        console.log('LLM analysis complete', enhancedPosts);
        
    } catch (error) {
        console.error('LLM analysis failed:', error);
        analysisStatus = 'error';
        enhancedPosts = [];
    } finally {
        isAnalyzing = false;
        updateOverlay();
    }
}

// Overlay UI Functions
async function showOverlay() {
    if (overlayElement) {
        overlayElement.remove();
    }

    // Ensure config is loaded before showing overlay
    await loadConfig();

    overlayElement = document.createElement('div');
    overlayElement.id = 'fb-scraper-overlay';
    overlayElement.innerHTML = `
        <div class="fb-scraper-container">
            <div class="fb-scraper-header">
                <h2>📊 Facebook Timeline Harvester</h2>
                <div class="fb-scraper-header-actions">
                    <button class="fb-scraper-btn fb-scraper-btn-start" id="fb-scraper-start-btn" style="display: ${isScrolling ? 'none' : 'block'}">
                        ▶ Start Scraping
                    </button>
                    <button class="fb-scraper-btn fb-scraper-btn-stop" id="fb-scraper-stop-btn" style="display: ${isScrolling ? 'block' : 'none'}">
                        ⏹ Stop Scraping
                    </button>
                    <button class="fb-scraper-close" id="fb-scraper-close-btn">✕</button>
                </div>
            </div>
            <div class="fb-scraper-stats">
                <div class="stat-item">
                    <span class="stat-label">Posts Collected:</span>
                    <span class="stat-value" id="fb-scraper-count">0</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Target:</span>
                    <span class="stat-value">${MAX_POSTS}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Status:</span>
                    <span class="stat-value" id="fb-scraper-status">${isScrolling ? '🟢 Scraping...' : '🔴 Stopped'}</span>
                </div>
            </div>
            <div class="fb-scraper-tabs">
                <button class="fb-scraper-tab active" data-tab="raw">📋 Raw</button>
                <button class="fb-scraper-tab" data-tab="enhanced">✨ Enhanced Feed</button>
                <button class="fb-scraper-tab" data-tab="config">⚙️ Configuration</button>
            </div>
            <div class="fb-scraper-content">
                <div class="fb-scraper-tab-content active" id="fb-scraper-tab-raw">
                    <div class="fb-scraper-posts" id="fb-scraper-posts-list">
                        <div class="fb-scraper-empty">Waiting for posts...</div>
                    </div>
                </div>
                <div class="fb-scraper-tab-content" id="fb-scraper-tab-enhanced">
                    <div class="fb-scraper-enhanced-header">
                        <button class="fb-scraper-btn fb-scraper-btn-analyze" id="fb-scraper-reanalyze-btn">🔄 Re-analyze</button>
                    </div>
                    <div class="fb-scraper-enhanced-status" id="fb-scraper-enhanced-status"></div>
                    <div class="fb-scraper-posts" id="fb-scraper-enhanced-list">
                        <div class="fb-scraper-empty">Waiting for raw feed fetching...</div>
                    </div>
                </div>
                <div class="fb-scraper-tab-content" id="fb-scraper-tab-config">
                    <div class="fb-scraper-config">
                        <div class="fb-scraper-config-section">
                            <label class="fb-scraper-config-label">Category</label>
                            <input type="text" 
                                   class="fb-scraper-config-input" 
                                   id="fb-scraper-category" 
                                   placeholder="e.g., Ad, Tech, LLM..."
                                   value="${config.category}">
                            <div class="fb-scraper-config-hint">Enter a category to tag your scraped posts</div>
                        </div>
                        
                        <div class="fb-scraper-config-section">
                            <label class="fb-scraper-config-label">LLM Provider & Model</label>
                            <div class="fb-scraper-llm-row">
                                <input type="radio" 
                                       name="llm-provider" 
                                       id="llm-openai" 
                                       value="openai" 
                                       ${config.llmProvider === 'openai' ? 'checked' : ''}>
                                <label for="llm-openai" class="fb-scraper-llm-label">OPEN AI</label>
                                <select class="fb-scraper-llm-select" id="llm-openai-model">
                                    ${OPENAI_MODELS.map(m => 
                                        `<option value="${m.value}" ${config.openai.model === m.value ? 'selected' : ''}>${m.label}</option>`
                                    ).join('')}
                                </select>
                                <input type="password" 
                                       class="fb-scraper-llm-apikey" 
                                       id="llm-openai-apikey" 
                                       placeholder="API Key"
                                       value="${config.openai.apiKey}">
                            </div>
                            <div class="fb-scraper-llm-row">
                                <input type="radio" 
                                       name="llm-provider" 
                                       id="llm-gemini" 
                                       value="gemini" 
                                       ${config.llmProvider === 'gemini' ? 'checked' : ''}>
                                <label for="llm-gemini" class="fb-scraper-llm-label">GEMINI</label>
                                <select class="fb-scraper-llm-select" id="llm-gemini-model">
                                    ${GEMINI_MODELS.map(m => 
                                        `<option value="${m.value}" ${config.gemini.model === m.value ? 'selected' : ''}>${m.label}</option>`
                                    ).join('')}
                                </select>
                                <input type="password" 
                                       class="fb-scraper-llm-apikey" 
                                       id="llm-gemini-apikey" 
                                       placeholder="API Key"
                                       value="${config.gemini.apiKey}">
                            </div>
                            <div class="fb-scraper-config-hint">Select one LLM provider and configure its model and API key</div>
                        </div>
                        
                        <div class="fb-scraper-config-section">
                            <label class="fb-scraper-config-label">LLM Prompt</label>
                            <textarea class="fb-scraper-config-textarea" 
                                      id="fb-scraper-prompt" 
                                      placeholder="Enter instructions for the LLM to analyze the scraped posts..."
                                      rows="6">${config.prompt || ''}</textarea>
                            <div class="fb-scraper-config-hint">Enter the prompt/instructions that will be sent to the LLM for analyzing the scraped posts</div>
                        </div>
                        
                        <div class="fb-scraper-config-actions">
                            <button class="fb-scraper-btn fb-scraper-btn-save" id="fb-scraper-save-config">💾 Save Configuration</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Add styles
    const style = document.createElement('style');
    style.textContent = `
        #fb-scraper-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.95);
            z-index: 999999;
            display: flex;
            justify-content: center;
            align-items: center;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            overflow-y: auto;
        }
        .fb-scraper-container {
            width: 90%;
            max-width: 900px;
            background: #1a1a1a;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
            margin: 40px auto;
            display: flex;
            flex-direction: column;
            max-height: 90vh;
        }
        .fb-scraper-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 24px 32px;
            border-bottom: 1px solid #333;
        }
        .fb-scraper-header h2 {
            margin: 0;
            color: #fff;
            font-size: 24px;
            font-weight: 600;
        }
        .fb-scraper-header-actions {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .fb-scraper-btn {
            padding: 10px 20px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .fb-scraper-btn-start {
            background: #4267B2;
            color: #fff;
        }
        .fb-scraper-btn-start:hover {
            background: #365899;
            transform: translateY(-1px);
        }
        .fb-scraper-btn-stop {
            background: #e41e3f;
            color: #fff;
        }
        .fb-scraper-btn-stop:hover {
            background: #c91e3f;
            transform: translateY(-1px);
        }
        .fb-scraper-close {
            background: #333;
            border: none;
            color: #fff;
            width: 36px;
            height: 36px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
        }
        .fb-scraper-close:hover {
            background: #444;
            transform: scale(1.1);
        }
        .fb-scraper-stats {
            display: flex;
            gap: 24px;
            padding: 20px 32px;
            border-bottom: 1px solid #333;
            background: #222;
        }
        .stat-item {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .stat-label {
            color: #999;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .stat-value {
            color: #fff;
            font-size: 20px;
            font-weight: 600;
        }
        .fb-scraper-tabs {
            display: flex;
            gap: 8px;
            padding: 0 32px;
            border-bottom: 1px solid #333;
            background: #222;
        }
        .fb-scraper-tab {
            padding: 12px 24px;
            background: transparent;
            border: none;
            border-bottom: 2px solid transparent;
            color: #999;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s;
        }
        .fb-scraper-tab:hover {
            color: #fff;
        }
        .fb-scraper-tab.active {
            color: #4267B2;
            border-bottom-color: #4267B2;
        }
        .fb-scraper-tab-content {
            display: none;
            flex: 1;
            overflow-y: auto;
            padding: 24px 32px;
        }
        .fb-scraper-tab-content.active {
            display: block;
        }
        .fb-scraper-content {
            flex: 1;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
        }
        .fb-scraper-posts {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
        .fb-scraper-post {
            background: #252525;
            border-radius: 12px;
            padding: 20px;
            border-left: 4px solid #4267B2;
            transition: all 0.2s;
        }
        .fb-scraper-post:hover {
            background: #2a2a2a;
            transform: translateX(4px);
        }
        .fb-scraper-post-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }
        .fb-scraper-post-author {
            color: #4267B2;
            font-weight: 600;
            font-size: 16px;
            text-decoration: none;
        }
        .fb-scraper-post-author:hover {
            text-decoration: underline;
        }
        .fb-scraper-post-type {
            background: #333;
            color: #fff;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 11px;
            text-transform: uppercase;
            font-weight: 600;
        }
        .fb-scraper-post-type.sponsor {
            background: #ff6b6b;
        }
        .fb-scraper-post-type.user {
            background: #4267B2;
        }
        .fb-scraper-post-content {
            color: #ddd;
            font-size: 14px;
            line-height: 1.6;
            margin-bottom: 12px;
            max-height: 100px;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .fb-scraper-post-link {
            color: #999;
            font-size: 12px;
            text-decoration: none;
            word-break: break-all;
        }
        .fb-scraper-post-link:hover {
            color: #4267B2;
        }
        .fb-scraper-empty {
            text-align: center;
            color: #666;
            padding: 40px;
            font-size: 16px;
        }
        /* Scrollbar styling */
        .fb-scraper-content::-webkit-scrollbar {
            width: 8px;
        }
        .fb-scraper-content::-webkit-scrollbar-track {
            background: #1a1a1a;
        }
        .fb-scraper-content::-webkit-scrollbar-thumb {
            background: #444;
            border-radius: 4px;
        }
        .fb-scraper-content::-webkit-scrollbar-thumb:hover {
            background: #555;
        }
        .fb-scraper-config {
            display: flex;
            flex-direction: column;
            gap: 24px;
        }
        .fb-scraper-config-section {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .fb-scraper-config-label {
            color: #fff;
            font-size: 14px;
            font-weight: 600;
        }
        .fb-scraper-config-input {
            padding: 12px 16px;
            background: #252525;
            border: 1px solid #333;
            border-radius: 8px;
            color: #fff;
            font-size: 14px;
            transition: all 0.2s;
        }
        .fb-scraper-config-input:focus {
            outline: none;
            border-color: #4267B2;
            background: #2a2a2a;
        }
        .fb-scraper-config-textarea {
            padding: 12px 16px;
            background: #252525;
            border: 1px solid #333;
            border-radius: 8px;
            color: #fff;
            font-size: 14px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            resize: vertical;
            transition: all 0.2s;
            width: 100%;
            box-sizing: border-box;
        }
        .fb-scraper-config-textarea:focus {
            outline: none;
            border-color: #4267B2;
            background: #2a2a2a;
        }
        .fb-scraper-config-textarea::placeholder {
            color: #666;
        }
        .fb-scraper-config-hint {
            color: #999;
            font-size: 12px;
        }
        .fb-scraper-llm-row {
            display: grid;
            grid-template-columns: auto 100px 1fr 2fr;
            gap: 12px;
            align-items: center;
            padding: 12px;
            background: #252525;
            border-radius: 8px;
            border: 1px solid #333;
        }
        .fb-scraper-llm-row input[type="radio"] {
            width: 18px;
            height: 18px;
            cursor: pointer;
        }
        .fb-scraper-llm-label {
            color: #fff;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
        }
        .fb-scraper-llm-select {
            padding: 10px 12px;
            background: #1a1a1a;
            border: 1px solid #333;
            border-radius: 6px;
            color: #fff;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.2s;
        }
        .fb-scraper-llm-select:focus {
            outline: none;
            border-color: #4267B2;
        }
        .fb-scraper-llm-apikey {
            padding: 10px 12px;
            background: #1a1a1a;
            border: 1px solid #333;
            border-radius: 6px;
            color: #fff;
            font-size: 14px;
            font-family: monospace;
            transition: all 0.2s;
        }
        .fb-scraper-llm-apikey:focus {
            outline: none;
            border-color: #4267B2;
        }
        .fb-scraper-llm-apikey::placeholder {
            color: #666;
        }
        .fb-scraper-config-actions {
            display: flex;
            justify-content: flex-end;
            padding-top: 8px;
        }
        .fb-scraper-btn-save {
            background: #10b981;
            color: #fff;
        }
        .fb-scraper-btn-save:hover {
            background: #059669;
        }
        .fb-scraper-enhanced-header {
            display: flex;
            justify-content: flex-end;
            margin-bottom: 16px;
        }
        .fb-scraper-btn-analyze {
            background: #8b5cf6;
            color: #fff;
        }
        .fb-scraper-btn-analyze:hover {
            background: #7c3aed;
            transform: translateY(-1px);
        }
        .fb-scraper-enhanced-status {
            margin-bottom: 16px;
            padding: 12px;
            background: #252525;
            border-radius: 8px;
            border-left: 4px solid #4267B2;
        }
        .fb-scraper-status-message {
            color: #fff;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .fb-scraper-status-message.error {
            color: #ff6b6b;
        }
        .fb-scraper-enhanced-post {
            border-left-color: #8b5cf6;
        }
        .fb-scraper-post-meta {
            display: flex;
            gap: 8px;
            align-items: center;
        }
        .fb-scraper-post-category {
            background: #8b5cf6;
            color: #fff;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 11px;
            text-transform: uppercase;
            font-weight: 600;
        }
        .fb-scraper-post-importance {
            background: #333;
            color: #fff;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
        }
        .fb-scraper-post-summary {
            background: #2a2a2a;
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 12px;
            color: #ddd;
            font-size: 14px;
            line-height: 1.6;
        }
        .fb-scraper-post-summary strong {
            color: #8b5cf6;
        }
        .fb-scraper-enhanced-content {
            white-space: pre-wrap;
            word-wrap: break-word;
            max-height: none;
            overflow: visible;
        }
        .fb-scraper-content-collapsed {
            max-height: 0;
            overflow: hidden;
            padding: 0;
            margin: 0;
            transition: max-height 0.3s ease-out, padding 0.3s ease-out, margin 0.3s ease-out;
        }
        .fb-scraper-content-toggle-wrapper {
            margin-bottom: 12px;
        }
        .fb-scraper-content-toggle {
            background: #333;
            border: 1px solid #444;
            color: #fff;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
            margin-bottom: 8px;
        }
        .fb-scraper-content-toggle:hover {
            background: #444;
            border-color: #555;
        }
        .fb-scraper-content-toggle .toggle-icon {
            font-size: 10px;
            transition: transform 0.2s;
        }
        .fb-scraper-content-toggle .toggle-text {
            user-select: none;
        }
    `;
    document.head.appendChild(style);
    document.body.appendChild(overlayElement);

    // Close button handler
    document.getElementById('fb-scraper-close-btn').addEventListener('click', () => {
        hideOverlay();
        if (isScrolling) {
            isScrolling = false;
            chrome.runtime.sendMessage({ type: 'statusChanged', isRunning: false });
        }
    });

    // Start button handler
    const startBtn = document.getElementById('fb-scraper-start-btn');
    if (startBtn) {
        startBtn.addEventListener('click', () => {
                if (!isScrolling) {
                    isScrolling = true;
                    scrappedPosts = []; // Reset data
                    enhancedPosts = []; // Reset enhanced posts
                    analysisStatus = 'waiting_for_raw'; // Set status
                    console.log("Starting scraping...");
                    autoScroll();
                    updateOverlay();
                }
        });
    }

    // Stop button handler
    const stopBtn = document.getElementById('fb-scraper-stop-btn');
    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            if (isScrolling) {
                isScrolling = false;
                console.log("Stopping scraping");
                updateOverlay();
                chrome.runtime.sendMessage({ type: 'statusChanged', isRunning: false });
            }
        });
    }

    // Tab switching
    const tabButtons = overlayElement.querySelectorAll('.fb-scraper-tab');
    const tabContents = overlayElement.querySelectorAll('.fb-scraper-tab-content');
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.getAttribute('data-tab');
            
            // Update active states
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            
            button.classList.add('active');
            document.getElementById(`fb-scraper-tab-${targetTab}`).classList.add('active');
            
            // Update enhanced feed when switching to it
            if (targetTab === 'enhanced') {
                updateOverlay();
            }
        });
    });

    // Re-analyze button
    const reAnalyzeBtn = document.getElementById('fb-scraper-reanalyze-btn');
    if (reAnalyzeBtn) {
        reAnalyzeBtn.addEventListener('click', async () => {
            if (scrappedPosts.length === 0) {
                alert('No posts to analyze. Please collect posts first.');
                return;
            }
            if (isAnalyzing) {
                alert('Analysis already in progress. Please wait.');
                return;
            }
            await analyzePostsWithLLM();
        });
    }

    // Save config button
    const saveConfigBtn = document.getElementById('fb-scraper-save-config');
    if (saveConfigBtn) {
        saveConfigBtn.addEventListener('click', async () => {
            // Get category
            const categoryInput = document.getElementById('fb-scraper-category');
            config.category = categoryInput.value.trim();

            // Get prompt
            const promptInput = document.getElementById('fb-scraper-prompt');
            if (promptInput) {
                config.prompt = promptInput.value.trim();
            }

            // Get LLM provider
            const selectedProvider = overlayElement.querySelector('input[name="llm-provider"]:checked');
            if (selectedProvider) {
                config.llmProvider = selectedProvider.value;
            }

            // Get OpenAI config
            const openaiModel = document.getElementById('llm-openai-model');
            const openaiApiKey = document.getElementById('llm-openai-apikey');
            if (openaiModel && openaiApiKey) {
                config.openai.model = openaiModel.value;
                config.openai.apiKey = openaiApiKey.value;
            }

            // Get Gemini config
            const geminiModel = document.getElementById('llm-gemini-model');
            const geminiApiKey = document.getElementById('llm-gemini-apikey');
            if (geminiModel && geminiApiKey) {
                config.gemini.model = geminiModel.value;
                config.gemini.apiKey = geminiApiKey.value;
            }

            // Save to storage
            await saveConfig();
            
            // Show success feedback
            const originalText = saveConfigBtn.textContent;
            saveConfigBtn.textContent = '✓ Saved!';
            saveConfigBtn.style.background = '#10b981';
            setTimeout(() => {
                saveConfigBtn.textContent = originalText;
                saveConfigBtn.style.background = '#10b981';
            }, 2000);
        });
    }

    // Load config into UI when config tab is shown
    const configTab = document.getElementById('fb-scraper-tab-config');
    const configTabButton = overlayElement.querySelector('[data-tab="config"]');
    if (configTabButton) {
        configTabButton.addEventListener('click', async () => {
            await loadConfig();
            // Update UI with loaded config
            const categoryInput = document.getElementById('fb-scraper-category');
            if (categoryInput) categoryInput.value = config.category || '';
            
            const promptInput = document.getElementById('fb-scraper-prompt');
            if (promptInput) promptInput.value = config.prompt || '';
            
            const openaiRadio = document.getElementById('llm-openai');
            const geminiRadio = document.getElementById('llm-gemini');
            if (openaiRadio) openaiRadio.checked = config.llmProvider === 'openai';
            if (geminiRadio) geminiRadio.checked = config.llmProvider === 'gemini';
            
            const openaiModel = document.getElementById('llm-openai-model');
            const openaiApiKey = document.getElementById('llm-openai-apikey');
            if (openaiModel) openaiModel.value = config.openai.model || 'gpt-5-mini-2025-08-07';
            if (openaiApiKey) openaiApiKey.value = config.openai.apiKey || '';
            
            const geminiModel = document.getElementById('llm-gemini-model');
            const geminiApiKey = document.getElementById('llm-gemini-apikey');
            if (geminiModel) geminiModel.value = config.gemini.model || 'gemini-pro';
            if (geminiApiKey) geminiApiKey.value = config.gemini.apiKey || '';
        });
    }

    updateOverlay();
}

function updateOverlay() {
    if (!overlayElement) return;

    const countEl = overlayElement.querySelector('#fb-scraper-count');
    const statusEl = overlayElement.querySelector('#fb-scraper-status');
    const postsListEl = overlayElement.querySelector('#fb-scraper-posts-list');
    const enhancedListEl = overlayElement.querySelector('#fb-scraper-enhanced-list');
    const enhancedStatusEl = overlayElement.querySelector('#fb-scraper-enhanced-status');
    const startBtn = overlayElement.querySelector('#fb-scraper-start-btn');
    const stopBtn = overlayElement.querySelector('#fb-scraper-stop-btn');

    if (countEl) {
        countEl.textContent = scrappedPosts.length;
    }

    if (statusEl) {
        if (isScrolling) {
            statusEl.textContent = scrappedPosts.length >= MAX_POSTS ? '🟡 Complete' : '🟢 Scraping...';
        } else {
            statusEl.textContent = '🔴 Stopped';
        }
    }

    // Update button visibility
    if (startBtn) {
        startBtn.style.display = isScrolling ? 'none' : 'block';
    }
    if (stopBtn) {
        stopBtn.style.display = isScrolling ? 'block' : 'none';
    }

    // Update Raw tab posts
    if (postsListEl) {
        if (scrappedPosts.length === 0) {
            postsListEl.innerHTML = '<div class="fb-scraper-empty">Waiting for posts...</div>';
        } else {
            postsListEl.innerHTML = scrappedPosts.map((post, index) => `
                <div class="fb-scraper-post">
                    <div class="fb-scraper-post-header">
                        <a href="${post.poster.link}" target="_blank" class="fb-scraper-post-author">
                            ${post.poster.name}
                        </a>
                        <span class="fb-scraper-post-type ${post.type}">${post.type}</span>
                    </div>
                    <div class="fb-scraper-post-content">
                        ${escapeHtml(post.story_content || '(No content)').replace(/\n/g, '<br>')}
                    </div>
                    <a href="${post.permanent_link}" target="_blank" class="fb-scraper-post-link">
                        ${post.permanent_link}
                    </a>
                </div>
            `).join('');
        }
    }

    // Update Enhanced Feed tab
    if (enhancedStatusEl) {
        if (scrappedPosts.length === 0 || (analysisStatus === 'waiting_for_raw' && isScrolling)) {
            enhancedStatusEl.innerHTML = '<div class="fb-scraper-status-message">⏳ Waiting for raw feed fetching...</div>';
            enhancedStatusEl.style.display = 'block';
        } else if (isAnalyzing || analysisStatus === 'analyzing') {
            enhancedStatusEl.innerHTML = '<div class="fb-scraper-status-message">🤖 Waiting for LLM analysis...</div>';
            enhancedStatusEl.style.display = 'block';
        } else if (analysisStatus === 'error') {
            enhancedStatusEl.innerHTML = '<div class="fb-scraper-status-message error">❌ Analysis failed. Check console for details.</div>';
            enhancedStatusEl.style.display = 'block';
        } else if (analysisStatus === 'complete' && enhancedPosts.length > 0) {
            enhancedStatusEl.style.display = 'none';
        } else if (scrappedPosts.length > 0 && (analysisStatus === 'idle' || analysisStatus === 'waiting_for_raw')) {
            // Posts collected but not analyzed yet
            enhancedStatusEl.innerHTML = '<div class="fb-scraper-status-message">📋 Raw posts collected. Click "Re-analyze" to process them.</div>';
            enhancedStatusEl.style.display = 'block';
        } else {
            enhancedStatusEl.style.display = 'none';
        }
    }

    if (enhancedListEl) {
        if (scrappedPosts.length === 0) {
            enhancedListEl.innerHTML = '<div class="fb-scraper-empty">Waiting for raw feed fetching...</div>';
        } else if (isAnalyzing || analysisStatus === 'analyzing') {
            enhancedListEl.innerHTML = '<div class="fb-scraper-empty">Waiting for LLM analysis...</div>';
        } else if (analysisStatus === 'error') {
            enhancedListEl.innerHTML = '<div class="fb-scraper-empty">Analysis failed. Click "Re-analyze" to try again.</div>';
        } else if (enhancedPosts.length === 0 && scrappedPosts.length > 0) {
            enhancedListEl.innerHTML = '<div class="fb-scraper-empty">No user posts found (only sponsor/ad content).</div>';
        } else if (enhancedPosts.length > 0) {
            enhancedListEl.innerHTML = enhancedPosts.map((post, index) => `
                <div class="fb-scraper-post fb-scraper-enhanced-post">
                    <div class="fb-scraper-post-header">
                        <a href="${post.poster.link}" target="_blank" class="fb-scraper-post-author">
                            ${escapeHtml(post.poster.name)}
                        </a>
                        <div class="fb-scraper-post-meta">
                            <span class="fb-scraper-post-category">${escapeHtml(post.category || 'Uncategorized')}</span>
                            ${post.importance ? `<span class="fb-scraper-post-importance">⭐ ${post.importance}/10</span>` : ''}
                        </div>
                    </div>
                    <div class="fb-scraper-post-summary">
                        <strong>Summary:</strong> ${escapeHtml(post.summary || 'No summary available')}
                    </div>
                    <div class="fb-scraper-content-toggle-wrapper">
                        <button class="fb-scraper-content-toggle" data-post-index="${index}" type="button">
                            <span class="toggle-icon">▼</span> <span class="toggle-text">Show Raw Content</span>
                        </button>
                        <div class="fb-scraper-post-content fb-scraper-enhanced-content fb-scraper-content-collapsed" data-post-content="${index}">
                            ${escapeHtml(post.story_content || '(No content)').replace(/\n/g, '<br>')}
                        </div>
                    </div>
                    <a href="${post.permanent_link}" target="_blank" class="fb-scraper-post-link">
                        ${post.permanent_link}
                    </a>
                </div>
            `).join('');
            
            // Add event listeners for toggle buttons
            enhancedListEl.querySelectorAll('.fb-scraper-content-toggle').forEach(button => {
                button.addEventListener('click', (e) => {
                    const postIndex = button.getAttribute('data-post-index');
                    const contentEl = enhancedListEl.querySelector(`[data-post-content="${postIndex}"]`);
                    const toggleIcon = button.querySelector('.toggle-icon');
                    const toggleText = button.querySelector('.toggle-text');
                    
                    if (contentEl.classList.contains('fb-scraper-content-collapsed')) {
                        contentEl.classList.remove('fb-scraper-content-collapsed');
                        toggleIcon.textContent = '▲';
                        toggleText.textContent = 'Hide Raw Content';
                    } else {
                        contentEl.classList.add('fb-scraper-content-collapsed');
                        toggleIcon.textContent = '▼';
                        toggleText.textContent = 'Show Raw Content';
                    }
                });
            });
        }
    }
}

// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function hideOverlay() {
    if (overlayElement) {
        overlayElement.remove();
        overlayElement = null;
    }
}

// Removed auto-start, now manual trigger only
// setTimeout(autoScroll, 3000); // Auto-start removed