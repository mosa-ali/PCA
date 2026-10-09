#!/usr/bin/env python3
"""
FABLE-A033 originally wired seven host sources into the
PCADeviceActivityMonitor extension target. This follow-up adds the missing
DeviceActivityScheduleMapper source: the extension also compiles
DeviceActivityUsageAttribution and CallbackObservationLog, both of which
refer to DeviceActivityScheduleMapper.maximumMonitoredActivities. The
mapper's DeviceActivity and ManagedSettings imports are extension-safe;
this remains a build-phase/target-membership correction, not a source
behavior change. From the original unwired project, this script adds eight
PBXBuildFile entries (each
referencing an EXISTING PBXFileReference already used by the PCA target;
no new file references, no PBXGroup edit -- group membership is a
Navigator-only concern independent of a target's Compile Sources
membership) and appends them to the PCADeviceActivityMonitor target's
Sources build phase. Embedded validation checks exact target membership
without relying on the host app's separate Sources phase.

Same '%'-style formatting and generate_pbxproj.py-style must_replace
discipline as ios/scripts/generate_pbxproj.py, for the same reason (PBX
object syntax is brace-heavy). Kept as a permanent, reviewable record,
matching that script's own convention, since this workspace has no Xcode
to generate/verify it interactively. The CI Xcode build remains the
compiler-level confirmation for the extension target.

Deterministic and idempotent-checked: it repairs the original unwired
phase or adds only the missing mapper to the existing seven-file phase.
Repeated runs validate the exact monitor target membership and make no
duplicate project entries.
"""
import re

PROJECT_PATH = "PCA.xcodeproj/project.pbxproj"

# (filename, existing PBXFileReference id) -- verified directly against the
# current project.pbxproj before writing this script, not assumed.
SHARED_FILES = [
    ("CallbackObservationLog.swift", "B10000000000000000000004", "B20000000000000000000001"),
    ("DeviceActivityCallbackHealth.swift", "B10000000000000000000006", "B20000000000000000000002"),
    ("DeviceActivityScheduleMapper.swift", "B10000000000000000000008", "B20000000000000000000008"),
    ("FamilyActivitySelectionStore.swift", "B10000000000000000000012", "B20000000000000000000003"),
    ("ShieldSafetyValidator.swift", "B10000000000000000000021", "B20000000000000000000004"),
    ("ScheduleEngine.swift", "B1000000000000000000002D", "B20000000000000000000005"),
    ("ScheduleModels.swift", "B1000000000000000000002F", "B20000000000000000000006"),
    ("PolicySyncSchema.swift", "B10000000000000000000034", "B20000000000000000000007"),
]

SOURCES_PHASE_ID = "B1000000000000000000005C"
MAPPER_BUILD_FILE_ID = "B20000000000000000000008"
MAPPER_BUILD_FILE = "%s /* DeviceActivityScheduleMapper.swift in Sources */" % MAPPER_BUILD_FILE_ID
MAPPER_BUILD_FILE_DEFINITION = (
    '\t\t%s /* DeviceActivityScheduleMapper.swift in Sources */ = {isa = PBXBuildFile; '
    'fileRef = B10000000000000000000008 /* DeviceActivityScheduleMapper.swift */; };'
) % MAPPER_BUILD_FILE_ID
OLD_SOURCES_PHASE = (
    '\t\t%s /* Sources */ = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; '
    'files = (B10000000000000000000057 /* DeviceActivityMonitorExtension.swift in Sources */); '
    'runOnlyForDeploymentPostprocessing = 0; };'
) % SOURCES_PHASE_ID


def monitor_sources_phase(text):
    matches = re.findall(
        r"(?m)^\s*%s /\* Sources \*/ = \{isa = PBXSourcesBuildPhase;[^\n]*\};"
        % re.escape(SOURCES_PHASE_ID), text
    )
    assert len(matches) == 1, "PCADeviceActivityMonitor Sources phase is missing or duplicated"
    return matches[0]


def validate(text):
    phase = monitor_sources_phase(text)
    assert phase.count(MAPPER_BUILD_FILE) == 1, \
        "DeviceActivityScheduleMapper is not wired exactly once to the monitor target"
    definitions = re.findall(
        r"(?m)^\s*%s /\* DeviceActivityScheduleMapper.swift in Sources \*/ = \{[^\n]*\};"
        % re.escape(MAPPER_BUILD_FILE_ID), text
    )
    assert len(definitions) == 1 and definitions[0].strip() == MAPPER_BUILD_FILE_DEFINITION.strip(), \
        "DeviceActivityScheduleMapper build-file reference is missing or incorrect"
    file_refs = re.findall(
        r"(?m)^\s*B10000000000000000000008 /\* DeviceActivityScheduleMapper.swift \*/ = \{isa = PBXFileReference;[^\n]*\};",
        text
    )
    assert len(file_refs) == 1, "DeviceActivityScheduleMapper file reference is missing or duplicated"

with open(PROJECT_PATH, "r", encoding="utf-8") as f:
    text = f.read()

if OLD_SOURCES_PHASE in text:
    new_buildfile_lines = []
    new_buildfile_ids = []
    for filename, fileref_id, bfile in SHARED_FILES:
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
else:
    # Existing project snapshots may already carry the seven shared-source
    # entries and usage-attribution entry. Validate those exact entries, then
    # add only the missing mapper file to this extension target.
    phase = monitor_sources_phase(text)
    if MAPPER_BUILD_FILE in phase:
        validate(text)
        print("Already wired -- no changes made (idempotent no-op).")
    else:
        for filename, _fileref_id, buildfile_id in SHARED_FILES:
            if filename == "DeviceActivityScheduleMapper.swift":
                continue
            expected = "%s /* %s in Sources */" % (buildfile_id, filename)
            assert phase.count(expected) == 1, "Monitor shared-source phase drifted at " + filename
        assert MAPPER_BUILD_FILE_ID not in text, "Mapper build-file ID is already used elsewhere"
        assert text.count("B10000000000000000000008 /* DeviceActivityScheduleMapper.swift */ = {isa = PBXFileReference;") == 1, \
            "Mapper PBXFileReference is missing or duplicated"
        text = text.replace(
            "/* End PBXBuildFile section */",
            MAPPER_BUILD_FILE_DEFINITION + "\n/* End PBXBuildFile section */",
            1,
        )
        updated_phase = phase.replace("files = (", "files = (" + MAPPER_BUILD_FILE + ", ", 1)
        text = text.replace(phase, updated_phase, 1)
        validate(text)
        with open(PROJECT_PATH, "w", encoding="utf-8") as f:
            f.write(text)
        print("Added DeviceActivityScheduleMapper.swift to PCADeviceActivityMonitor Sources.")

validate(text)
