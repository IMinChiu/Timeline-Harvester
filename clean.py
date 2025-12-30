import json
import os
import re


def clean_content(text):
    if not text:
        return ""
    # Remove repetitive Facebook headers and single-character obfuscation lines
    text = re.sub(r'^(Facebook\s*)+', '', text, flags=re.MULTILINE)
    text = re.sub(r'(\b\w\b\n)+', '', text)
    text = re.sub(r'\n\s*\n', '\n', text)
    return text.strip()


def merge_and_finalize(input_dir, output_file):
    final_data = []
    seen = set()

    files = [f for f in os.listdir(input_dir) if f.endswith('.json')]
    print(f"Processing {len(files)} files...")

    for file in sorted(files):
        with open(os.path.join(input_dir, file), 'r', encoding='utf-8') as f:
            batch = json.load(f)
            for item in batch:
                content = item.get('content', "")
                # Fingerprint check to prevent cross-batch duplicates
                fingerprint = content[:50].strip()
                if fingerprint not in seen:
                    seen.add(fingerprint)
                    cleaned = clean_content(content)
                    if len(cleaned) > 20:
                        final_data.append({
                            "id": len(final_data) + 1,
                            "content": cleaned,
                            "urls": item.get('urls', [])
                        })

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(final_data, f, ensure_ascii=False, indent=2)
    print(
        f"Merge complete. Saved {len(final_data)} unique posts to {output_file}.")


if __name__ == "__main__":
    # Ensure you put all JSON batches in a folder named 'raw_data'
    merge_and_finalize('raw_data', 'Final_FB_Dataset.json')
