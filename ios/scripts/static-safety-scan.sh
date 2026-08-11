#!/usr/bin/env bash
# doc 07 PCA-IOS-001 / PCA-15 brief Section 16: reject any private-API,
# hidden-symbol-lookup, SpringBoard-manipulation, jailbreak-dependent, or
# unsupported Screen-Time-data-extraction pattern anywhere under ios/.
#
# Run from the ios/ directory (or pass a path as $1). Intended as an Xcode
# "Run Script" build phase and/or CI step -- this workspace has no Xcode,
# so this script has been run manually (see
# docs/MAC_XCODE_VALIDATION_CHECKLIST.md) rather than via a build phase.
#
# Exit code 0 = clean, 1 = a forbidden pattern was found.

set -euo pipefail
ROOT="${1:-.}"

PATTERN='dlopen|dlsym|NSSelectorFromString|perform\(Selector|method_exchangeImplementations|class_getInstanceMethod|objc_getClass|SBSSpringBoard|LSApplicationWorkspace|MCProfile|value\(forKeyPath|jailbreak|/var/mobile|MobileGestalt|IOKit'

MATCHES=$(grep -rniE "$PATTERN" --include="*.swift" "$ROOT" || true)

if [ -n "$MATCHES" ]; then
  echo "STATIC SAFETY SCAN: FAILED -- forbidden pattern(s) found:"
  echo "$MATCHES"
  exit 1
fi

echo "STATIC SAFETY SCAN: PASSED -- no private-API/hidden-symbol/jailbreak pattern found under $ROOT"
exit 0
