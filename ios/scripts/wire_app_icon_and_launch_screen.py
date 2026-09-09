#!/usr/bin/env python3
"""
FABLE-A034 (icon + launch-screen portion; the DEVELOPMENT_TEAM/Apple
Developer sub-item stays external, untouched here): wires the placeholder
Assets.xcassets/AppIcon.appiconset (see generate_app_icon.py) into the PCA
host target as a real resource, points ASSETCATALOG_COMPILER_APPICON_NAME
at it (currently "" -- an empty app icon name, a hard App Store/TestFlight
rejection), and turns on a minimal, storyboard-free launch screen via
INFOPLIST_KEY_UILaunchScreen_Generation (valid because
GENERATE_INFOPLIST_FILE = YES is already set for this target -- no
LaunchScreen.storyboard file is required).

Same '%'-style formatting, must_replace discipline, and idempotency-checked
one-shot-script convention as
wire_device_activity_monitor_shared_sources.py.
"""

PROJECT_PATH = "PCA.xcodeproj/project.pbxproj"

FILEREF_ID = "B20000000000000000000010"
BUILDFILE_ID = "B20000000000000000000011"

with open(PROJECT_PATH, "r", encoding="utf-8") as f:
    text = f.read()

if 'B20000000000000000000010 /* Assets.xcassets */' in text:
    print("Already wired -- no changes made (idempotent no-op).")
else:
    # --- PBXFileReference + PBXBuildFile ---
    fileref_line = (
        '\t\t%s /* Assets.xcassets */ = {isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; '
        'path = Assets.xcassets; sourceTree = "<group>"; };'
    ) % FILEREF_ID
    buildfile_line = (
        '\t\t%s /* Assets.xcassets in Resources */ = {isa = PBXBuildFile; fileRef = %s /* Assets.xcassets */; };'
    ) % (BUILDFILE_ID, FILEREF_ID)

    text = text.replace(
        "/* End PBXBuildFile section */",
        buildfile_line + "\n/* End PBXBuildFile section */",
        1,
    )
    text = text.replace(
        "/* End PBXFileReference section */",
        fileref_line + "\n/* End PBXFileReference section */",
        1,
    )

    # --- Add to the PCA group (Navigator) ---
    old_pca_group_tail = ', B1000000000000000000003B /* YouTube */); path = PCA; sourceTree = "<group>"; };'
    new_pca_group_tail = ', B1000000000000000000003B /* YouTube */, %s /* Assets.xcassets */); path = PCA; sourceTree = "<group>"; };' % FILEREF_ID
    assert old_pca_group_tail in text, "NOT FOUND: PCA group tail (has the file drifted since this script was written?)"
    text = text.replace(old_pca_group_tail, new_pca_group_tail, 1)

    # --- Add to the PCA target's Resources build phase ---
    old_resources_phase = (
        '\t\tA10000000000000000000701 /* Resources */ = {isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; '
        'files = (B100000000000000000000AA /* Localizable.xcstrings in Resources */); runOnlyForDeploymentPostprocessing = 0; };'
    )
    new_resources_phase = (
        '\t\tA10000000000000000000701 /* Resources */ = {isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; '
        'files = (B100000000000000000000AA /* Localizable.xcstrings in Resources */, %s /* Assets.xcassets in Resources */); runOnlyForDeploymentPostprocessing = 0; };'
    ) % BUILDFILE_ID
    assert old_resources_phase in text, "NOT FOUND: PCA Resources build phase (has the file drifted since this script was written?)"
    text = text.replace(old_resources_phase, new_resources_phase, 1)

    # --- Point ASSETCATALOG_COMPILER_APPICON_NAME at it + enable a minimal launch screen, both configs ---
    for config_name, old_line in [
        ("Debug", '\t\tA10000000000000000001003 /* Debug */ = {isa = XCBuildConfiguration; buildSettings = {ASSETCATALOG_COMPILER_APPICON_NAME = ""; CODE_SIGN_ENTITLEMENTS = PCA/PCA.entitlements; CODE_SIGN_STYLE = Automatic; "CODE_SIGNING_ALLOWED[sdk=iphonesimulator*]" = NO; CURRENT_PROJECT_VERSION = 1; GENERATE_INFOPLIST_FILE = YES; INFOPLIST_KEY_CFBundleDisplayName = PCA; IPHONEOS_DEPLOYMENT_TARGET = 17.0; MARKETING_VERSION = 0.1.0; PRODUCT_BUNDLE_IDENTIFIER = org.pca.app; SWIFT_VERSION = 5.0; TARGETED_DEVICE_FAMILY = "1,2";}; name = Debug; };'),
        ("Release", '\t\tA10000000000000000001004 /* Release */ = {isa = XCBuildConfiguration; buildSettings = {ASSETCATALOG_COMPILER_APPICON_NAME = ""; CODE_SIGN_ENTITLEMENTS = PCA/PCA.entitlements; CODE_SIGN_STYLE = Automatic; "CODE_SIGNING_ALLOWED[sdk=iphonesimulator*]" = NO; CURRENT_PROJECT_VERSION = 1; GENERATE_INFOPLIST_FILE = YES; INFOPLIST_KEY_CFBundleDisplayName = PCA; IPHONEOS_DEPLOYMENT_TARGET = 17.0; MARKETING_VERSION = 0.1.0; PRODUCT_BUNDLE_IDENTIFIER = org.pca.app; SWIFT_VERSION = 5.0; TARGETED_DEVICE_FAMILY = "1,2";}; name = Release; };'),
    ]:
        assert old_line in text, "NOT FOUND: host %s config (has the file drifted since this script was written?)" % config_name
        new_line = old_line.replace(
            'ASSETCATALOG_COMPILER_APPICON_NAME = "";',
            'ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;',
        ).replace(
            'GENERATE_INFOPLIST_FILE = YES;',
            'GENERATE_INFOPLIST_FILE = YES; INFOPLIST_KEY_UILaunchScreen_Generation = YES;',
        )
        text = text.replace(old_line, new_line, 1)

    with open(PROJECT_PATH, "w", encoding="utf-8") as f:
        f.write(text)

    print("Done. Wired Assets.xcassets/AppIcon.appiconset into the PCA target and enabled a generated launch screen.")
