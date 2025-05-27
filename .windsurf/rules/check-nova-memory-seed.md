---
trigger: always_on
description: Verify Nova memory seed file at session start
---

# Nova Memory Seed Check

This rule ensures that the Nova memory seed file is accessible and contains valid content at the start of each Windsurf session.

## Behavior

- Runs automatically when a new Windsurf session starts
- Verifies the memory seed file exists at the expected URL
- Validates the basic structure of the memory seed
- Reports any issues with accessibility or content

## Configuration

```yaml
# .windsurf/config.yaml
rules:
  check-nova-memory-seed:
    enabled: true
    memory_seed_url: "https://ambientpixels.ai/data/nova-session-boot.html"
    validate_structure: true
    check_required_sections:
      - "nova-behavior"
      - "mood-history"
      - "identity-core"
    timeout_ms: 5000  # 5 second timeout for the check
```

## Implementation Details

The rule will:
1. Attempt to fetch the memory seed from the configured URL
2. Verify the response status is 200 OK
3. Check for required sections in the content
4. Validate basic structure (JSON-like format)
5. Report any issues found

## Error Handling

- If the seed file is unreachable, it will suggest checking network connectivity
- If the content is invalid, it will highlight which validations failed
- Provides fallback behavior when the seed cannot be loaded

## Notes

- This check runs in the background and won't block the session
- Warnings will be shown in the Windsurf output panel
- The rule can be temporarily disabled if needed through the configuration