# Verification Progress Design

Manual full-file verification and post-repair verification report the current manifest entry and throttled SHA-256 byte progress. The overall bar uses processed bytes when manifest sizes are available and falls back to completed-file count otherwise.

The launcher shows the current file on the left, while the right side keeps file count and adds processed bytes. The lightweight pre-launch size check remains unchanged so launching is not slowed by hashing.
