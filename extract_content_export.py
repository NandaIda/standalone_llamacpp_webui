import json
import sys

# Check if file path is provided as argument
if len(sys.argv) < 2:
    print("Usage: python extract_content_export.py <file_path>")
    sys.exit(1)

file_path = sys.argv[1]

# Read the JSON file
with open(file_path, 'r') as f:
    data = json.load(f)

# Extract the 'content' field from the messages and write to conversation.md
with open('conversation.md', 'w') as f:
    for message in data['messages']:
        if 'content' in message:
            f.write(message['content'] + '\n\n')
