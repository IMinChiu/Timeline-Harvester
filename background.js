// background.js
chrome.action.onClicked.addListener((tab) => {
    // Check if it's a Facebook page
    if (tab.url && tab.url.includes('facebook.com')) {
        // Send message to content script to toggle overlay and start scraping
        chrome.tabs.sendMessage(tab.id, { action: 'toggleAndStart' });
    } else {
        // If not on Facebook, open Facebook in a new tab
        chrome.tabs.create({ url: 'https://www.facebook.com' });
    }
});

