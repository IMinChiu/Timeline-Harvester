// popup.js
let isRunning = false;

// Get current tab
async function getCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
}

// Check if current page is Facebook
function isFacebookPage(url) {
    return url && url.includes('facebook.com');
}

// Update UI status
function updateUI(running) {
    isRunning = running;
    const statusEl = document.getElementById('status');
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const infoEl = document.getElementById('info');
    
    if (running) {
        statusEl.textContent = 'Status: Scraping...';
        statusEl.className = 'status active';
        startBtn.style.display = 'none';
        stopBtn.style.display = 'block';
        infoEl.textContent = 'Collecting posts, please keep the page open';
    } else {
        statusEl.textContent = 'Status: Stopped';
        statusEl.className = 'status stopped';
        startBtn.style.display = 'block';
        stopBtn.style.display = 'none';
        infoEl.textContent = 'Click "Start Scraping" to begin collecting posts';
    }
}

// Send message to content script
async function sendMessageToContent(action) {
    try {
        const tab = await getCurrentTab();
        if (!isFacebookPage(tab.url)) {
            alert('Please use this extension on a Facebook page');
            return;
        }
        
        await chrome.tabs.sendMessage(tab.id, { action });
        
        // Update local status
        if (action === 'start') {
            updateUI(true);
        } else if (action === 'stop') {
            updateUI(false);
        }
    } catch (error) {
        console.error('Failed to send message:', error);
        alert('Unable to connect to page. Please refresh the Facebook page and try again');
    }
}

// Check current status
async function checkStatus() {
    try {
        const tab = await getCurrentTab();
        if (!isFacebookPage(tab.url)) {
            document.getElementById('status').textContent = 'Status: Please use on Facebook page';
            document.getElementById('startBtn').disabled = true;
            document.getElementById('stopBtn').disabled = true;
            return;
        }
        
        // Try to get current status
        chrome.tabs.sendMessage(tab.id, { action: 'getStatus' }, (response) => {
            if (chrome.runtime.lastError) {
                // If unable to connect, page might not be loaded yet
                updateUI(false);
                return;
            }
            if (response && response.isRunning !== undefined) {
                updateUI(response.isRunning);
            }
        });
    } catch (error) {
        console.error('Failed to check status:', error);
        updateUI(false);
    }
}

// Event listeners
document.getElementById('startBtn').addEventListener('click', () => {
    sendMessageToContent('start');
});

document.getElementById('stopBtn').addEventListener('click', () => {
    sendMessageToContent('stop');
});

// Check status on page load
checkStatus();

// Periodically check status (every 2 seconds)
setInterval(checkStatus, 2000);

