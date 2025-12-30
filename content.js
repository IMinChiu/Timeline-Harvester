/**
 * FB-Timeline-Harvester
 * Sequential Logic: Scroll -> Wait -> Expand -> Capture -> Auto-Relay
 */

const TOTAL_GOAL = 1000;
const STAGNATION_THRESHOLD = 50000; // 50 seconds

let currentGlobalCount = parseInt(localStorage.getItem('harvest_global_count')) || 0;
let lastCaptureTime = Date.now();
window.harvestedData = [];
window.seenFingerprints = new Set();
window.isProcessing = false;

async function runHarvestCycle() {
    if (window.isProcessing) return;
    window.isProcessing = true;

    // Check if goal is reached
    if (currentGlobalCount + window.harvestedData.length >= TOTAL_GOAL) {
        await stopAndRefresh(true);
        return;
    }

    // Check for stagnation
    const idleTime = Date.now() - lastCaptureTime;
    if (idleTime > STAGNATION_THRESHOLD && window.harvestedData.length > 0) {
        console.log("Stagnation detected. Saving progress and reloading...");
        await stopAndRefresh();
        return;
    }

    try {
        // Step 1: Smooth Scrolling
        window.scrollBy({ top: 800, behavior: 'smooth' });
        await new Promise(r => setTimeout(r, 2000));

        // Step 2: Handle Popups and Content Expansion
        const closeBtn = document.querySelector('div[aria-label="Close"], div[aria-label="關閉"]');
        if (closeBtn) closeBtn.click();

        const expandButtons = document.querySelectorAll('div[role="button"], span[role="button"]');
        expandButtons.forEach(btn => {
            const txt = btn.innerText;
            if (txt.includes("See more") || txt.includes("查看更多")) btn.click();
        });
        await new Promise(r => setTimeout(r, 1500));

        // Step 3: Data Capture
        const postTexts = document.querySelectorAll('div[data-testid="post_message"], .x11i5rnm.xat24cr, div[dir="auto"]');

        postTexts.forEach(textEl => {
            const container = textEl.closest('div[role="article"]') || textEl.parentElement.parentElement;
            if (!container || container.hasAttribute('data-harvested')) return;

            // Strip Emojis and Icons
            let cleanText = container.innerText.replace(/[\u\d][\u\d][\u\d][\u\d]|[\u2600-\u27BF]|[\uD83C-\uD83E][\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, "");
            cleanText = cleanText.trim();

            if (cleanText.length > 30) {
                const fingerprint = cleanText.substring(0, 50);
                if (!window.seenFingerprints.has(fingerprint)) {
                    container.setAttribute('data-harvested', 'true');
                    window.seenFingerprints.add(fingerprint);
                    lastCaptureTime = Date.now();

                    window.harvestedData.push({
                        content: cleanText,
                        urls: Array.from(container.querySelectorAll('a'))
                            .map(a => a.href)
                            .filter(u => u.startsWith('http') && !u.includes("facebook.com/groups"))
                    });

                    console.log(`Captured: [${currentGlobalCount + window.harvestedData.length}/${TOTAL_GOAL}]`);
                }
            }
        });
    } catch (err) {
        console.error("Cycle error:", err);
    } finally {
        window.isProcessing = false;
    }
}

async function stopAndRefresh(isFinal = false) {
    const capturedCount = window.harvestedData.length;
    if (capturedCount > 0) {
        const blob = new Blob([JSON.stringify(window.harvestedData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `FB_Batch_${currentGlobalCount + capturedCount}.json`;
        a.click();
    }

    localStorage.setItem('harvest_global_count', currentGlobalCount + capturedCount);

    if (isFinal) {
        console.log("Mission accomplished.");
        localStorage.removeItem('harvest_global_count');
    } else {
        location.reload();
    }
}

console.log("FB-Timeline-Harvester initialized.");
setInterval(runHarvestCycle, 6000);