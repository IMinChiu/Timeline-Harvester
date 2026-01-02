// content.js

// 1. Inject the interceptor into the "Main World"
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
(document.head || document.documentElement).appendChild(script);

let scrappedPosts = [];
let isScrolling = false; // Set to false, don't auto-start
const MAX_POSTS = 15; // Set your limit here
let overlayElement = null;

// Configuration state
let config = {
    category: '',
    prompt: '',
    llmProvider: 'openai', // 'openai' or 'gemini'
    openai: {
        model: 'gpt-4',
        apiKey: ''
    },
    gemini: {
        model: 'gemini-pro',
        apiKey: ''
    }
};

// OpenAI models
const OPENAI_MODELS = [
    { value: 'gpt-4', label: 'GPT-4' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' }
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
                    console.log("Starting scraping...");
                    autoScroll();
                    updateOverlay();
                }
            } else {
                // If overlay is closed, open it and start
                if (!isScrolling) {
                    isScrolling = true;
                    scrappedPosts = []; // Reset data
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
                <button class="fb-scraper-tab active" data-tab="posts">📋 Posts</button>
                <button class="fb-scraper-tab" data-tab="config">⚙️ Configuration</button>
            </div>
            <div class="fb-scraper-content">
                <div class="fb-scraper-tab-content active" id="fb-scraper-tab-posts">
                    <div class="fb-scraper-posts" id="fb-scraper-posts-list">
                        <div class="fb-scraper-empty">Waiting for posts...</div>
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
        });
    });

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
            if (openaiModel) openaiModel.value = config.openai.model || 'gpt-4';
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
                        ${post.story_content || '(No content)'}
                    </div>
                    <a href="${post.permanent_link}" target="_blank" class="fb-scraper-post-link">
                        ${post.permanent_link}
                    </a>
                </div>
            `).join('');
        }
    }
}

function hideOverlay() {
    if (overlayElement) {
        overlayElement.remove();
        overlayElement = null;
    }
}

// Removed auto-start, now manual trigger only
// setTimeout(autoScroll, 3000); // Auto-start removed