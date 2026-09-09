#!/usr/bin/env python3
"""
FABLE-A033: the PCADeviceActivityMonitor extension target's Sources build
phase compiled only its own DeviceActivityMonitorExtension.swift, but that
file references types defined in 7 host-app-only source files (already
compiled into the PCA target, never into this extension target) --
CallbackObservationLog, DeviceActivityCallbackHealth,
FamilyActivitySelectionStore, ShieldSafetyValidator, ScheduleEngine,
ScheduleModels, PolicySyncSchema. Every dependency file imports only
Foundation (one conditionally FamilyControls, which the extension is
already entitled for) -- extension-safe, no host-lifecycle/UIKit
dependency -- so this is purely a build-phase/target-membership omission,
not a source change. This script adds 7 new PBXBuildFile entries (each
referencing an EXISTING PBXFileReference already used by the PCA target;
no new file references, no PBXGroup edit -- group membership is a
Navigator-only concern independent of a target's Compile Sources
membership) and appends them to the PCADeviceActivityMonitor target's
Sources build phase.

Same '%'-style formatting and generate_pbxproj.py-style must_replace
discipline as ios/scripts/generate_pbxproj.py, for the same reason (PBX
object syntax is brace-heavy). Kept as a permanent, reviewable record,
matching that script's own convention, since this workspace has no Xcode
to generate/verify it interactively -- see
docs/MAC_XCODE_VALIDATION_CHECKLIST.md Section 0, updated alongside this
script to list the additional files that should now appear in the
extension's Compile Sources.

Deterministic and idempotent-checked: run once against the current
project.pbxproj (which already has PCADeviceActivityMonitor's Sources
phase from generate_pbxproj.py); running it again is a no-op guarded by
_already_wired() below, rather than corrupting the file with duplicate
entries.
"""
import re

PROJECT_PATH = "PCA.xcodeproj/project.pbxproj"

_counter = 0
def nid():
    global _counter
    _counter += 1
    # A different fixed prefix from generate_pbxproj.py's "B1" + generate_pbxproj.py's
    # own counter range (which stops well under 0x100) so IDs can never collide with
    # that script's output even if both were (hypothetically) re-run in sequence.
    return "B2%022X" % _counter

# (filename, existing PBXFileReference id) -- verified directly against the
# current project.pbxproj before writing this script, not assumed.
SHARED_FILES = [
    ("CallbackObservationLog.swift", "B10000000000000000000004"),
    ("DeviceActivityCallbackHealth.swift", "B10000000000000000000006"),
    ("FamilyActivitySelectionStore.swift", "B10000000000000000000012"),
    ("ShieldSafetyValidator.swift", "B10000000000000000000021"),
    ("ScheduleEngine.swift", "B1000000000000000000002D"),
    ("ScheduleModels.swift", "B1000000000000000000002F"),
    ("PolicySyncSchema.swift", "B10000000000000000000034"),
]

SOURCES_PHASE_ID = "B1000000000000000000005C"
OLD_SOURCES_PHASE = (
    '\t\t%s /* Sources */ = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; '
    'files = (B10000000000000000000057 /* DeviceActivityMonitorExtension.swift in Sources */); '
    'runOnlyForDeploymentPostprocessing = 0; };'
) % SOURCES_PHASE_ID

with open(PROJECT_PATH, "r", encoding="utf-8") as f:
    text = f.read()

if OLD_SOURCES_PHASE not in text:
    # Either already wired by a prior run of this exact script (the
    # extension's Sources phase no longer matches the pre-wiring text
    # because it already carries the 7 shared build files -- a real
    # idempotency check, not a filename guess that would false-positive on
    # the identically-named PBXBuildFile entries the PCA host target has
    # always had for these same files), or the file has drifted for some
    # other reason and needs a fresh look before re-running this script.
    already_wired = "B10000000000000000000057 /* DeviceActivityMonitorExtension.swift in Sources */, " in text
    assert already_wired, "NOT FOUND: PCADeviceActivityMonitor Sources phase in its expected pre-wiring form, and it does not look already-wired either -- the file has drifted since this script was written; inspect before re-running."
    print("Already wired -- no changes made (idempotent no-op).")
else:

    new_buildfile_lines = []
    new_buildfile_ids = []
    for filename, fileref_id in SHARED_FILES:
        bfile = nid()
        new_buildfile_lines.append(
            '\t\t%s /* %s in Sources */ = {isa = PBXBuildFile; fileRef = %s /* %s */; };'
            % (bfile, filename, fileref_id, filename)
        )
        new_buildfile_ids.append((bfile, filename))

    text = text.replace(
        "/* End PBXBuildFile section */",
        "\n".join(new_buildfile_lines) + "\n/* End PBXBuildFile section */",
        1,
    )

    new_files_str = ", ".join("%s /* %s in Sources */" % (bid, name) for bid, name in new_buildfile_ids)
    new_sources_phase = OLD_SOURCES_PHASE.replace(
        "files = (B10000000000000000000057 /* DeviceActivityMonitorExtension.swift in Sources */);",
        "files = (B10000000000000000000057 /* DeviceActivityMonitorExtension.swift in Sources */, %s);" % new_files_str,
    )
    text = text.replace(OLD_SOURCES_PHASE, new_sources_phase, 1)

    with open(PROJECT_PATH, "w", encoding="utf-8") as f:
        f.write(text)

    print("Done. Added %d PBXBuildFile entries to PCADeviceActivityMonitor's Sources phase:" % len(new_buildfile_ids))
    for _bid, name in new_buildfile_ids:
        print("  -", name)
