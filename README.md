# FB-Timeline-Harvester

A high-stability browser extension designed for large-scale Facebook Timeline data collection. This tool solves the common "Infinite Scroll Crash" by utilizing a sequential relay architecture.

## Key Features
- **Sequential Execution Loop**: Orders Scroll -> Wait -> Expand -> Capture to prevent browser thread locking.
- **Stateful Relay**: Uses `localStorage` to keep track of progress across automatic page reloads.
- **Anti-Stagnation**: Detects feed loading failures and triggers a clean refresh to bypass memory leaks.
- **Noise Filter**: Integrated Python post-processor to remove anti-scraping obfuscation.

## Project Structure
- `manifest.json`: Extension configuration.
- `content.js`: Main harvesting engine (No icons/emojis, English logs).
- `clean.py`: Batch merger and data de-obfuscator.

## Installation & Usage
1. Load the folder as an **Unpacked Extension** in Chrome (Developer Mode).
2. Navigate to your Facebook Timeline.
3. The script will run automatically. Monitor the progress in the Browser Console (F12).
4. Collected batches will download as JSON files. Use `python clean.py` to merge them.

## Disclaimer
This project is for academic research and personal data backup only. Users are responsible for complying with the platform's Terms of Service.

## License
Licensed under the **Apache License, Version 2.0**. See the `LICENSE` file for details.