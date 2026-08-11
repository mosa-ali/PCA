#!/usr/bin/env python3
"""
PCA-15 correction F2: generates the corrected ios/PCA.xcodeproj/project.pbxproj,
adding: (a) PBXFileReference/PBXBuildFile entries for every PCA-15 Swift
source file so far missing from the project (all of them, per the F2
finding), organized into subgroups matching the on-disk directory layout;
(b) three new extension targets (PCADeviceActivityMonitor,
PCAShieldConfiguration, PCAShieldAction), each with their own physical
Info.plist + entitlements file, Sources/Frameworks/Resources build
phases, and XCBuildConfigurations; (c) an "Embed App Extensions" copy
files phase + target dependencies on the host PCA target so the three
extensions are actually embedded in the app bundle; (d) a
PCA.entitlements file (Family Controls + App Group) wired onto the host
target's existing Debug/Release configurations.

Uses '%'-style string formatting throughout (never f-strings/.format())
because PBX object syntax is itself brace-heavy ('{...};'), which
collides with f-string/.format() brace-escaping rules; '%' substitution
has no such conflict.

Kept in ios/scripts/ as a permanent, reviewable record of exactly how the
project file was constructed, since this workspace has no Xcode to
generate/verify it interactively. Deterministic: re-running against the
ORIGINAL project.pbxproj always produces the same output (not meant to
run against its own prior output).
"""
import re

PROJECT_PATH = "PCA.xcodeproj/project.pbxproj"

_counter = 0
def nid():
    global _counter
    _counter += 1
    return "B1%022X" % _counter

# ---------------------------------------------------------------------------
# File inventory
# ---------------------------------------------------------------------------

PCA_SUBGROUPS = [
    ("AI", ["ClassifierRuntimeBoundary.swift"]),
    ("DeviceActivity", ["CallbackObservationLog.swift", "DeviceActivityCallbackHealth.swift", "DeviceActivityScheduleMapper.swift"]),
    ("Enrollment", ["ChildEnrollmentCoordinator.swift"]),
    ("FamilyControls", ["ChildAuthorizationCenter.swift", "ChildAuthorizationState.swift", "FamilyActivitySelectionStore.swift"]),
    ("Keychain", ["FamilyKeyMaterialStore.swift", "KeychainStore.swift"]),
    ("Location", ["LocationCapabilityAdapter.swift"]),
    ("ManagedSettings", ["EmergencySurface.swift", "ManagedSettingsAdapter.swift", "ShieldSafetyValidator.swift"]),
    ("ParentStatus", ["ChildStatusSnapshot.swift"]),
    ("Prayer", ["PrayerNotificationScheduler.swift"]),
    ("Retention", ["RetentionWindow.swift"]),
    ("Schedule", ["ScheduleEngine.swift", "ScheduleModels.swift"]),
    ("Sync", ["PolicyApplicationGate.swift", "PolicySyncSchema.swift", "SyncConnectionState.swift"]),
    ("YouTube", ["YouTubeVisibilityMode.swift"]),
]

PCATESTS_NEW_FILES = [
    "CallbackObservationLogTests.swift",
    "ChildAuthorizationCenterTests.swift",
    "DeviceActivityCallbackHealthTests.swift",
    "EmergencyShieldFloorTests.swift",
    "KeychainStoreTests.swift",
    "LocationCapabilityAdapterTests.swift",
    "PolicyApplicationGateTests.swift",
    "PolicySyncDecoderTests.swift",
    "RemainingAdaptersTests.swift",
    "RetentionWindowTests.swift",
    "ScheduleEngineTests.swift",
    "ShieldSafetyValidatorTests.swift",
    "SyncConnectionStateTests.swift",
]

EXTENSIONS = [
    ("PCADeviceActivityMonitor", "DeviceActivityMonitorExtension.swift", "deviceactivitymonitor"),
    ("PCAShieldConfiguration", "ShieldConfigurationExtension.swift", "shieldconfiguration"),
    ("PCAShieldAction", "ShieldActionExtension.swift", "shieldaction"),
]

# ---------------------------------------------------------------------------
# Build up new object text blocks
# ---------------------------------------------------------------------------

buildfile_lines = []
fileref_lines = []
group_lines = []
xcbuildconfig_lines = []
xcconfiglist_lines = []
frameworks_phase_lines = []
resources_phase_lines = []
sources_phase_lines = []
target_lines = []
containeritemproxy_lines = []
targetdependency_lines = []

sources_files_by_target = {"PCA": [], "PCATests": []}

def add_source_file(target_key, filename):
    fref = nid()
    bfile = nid()
    fileref_lines.append('\t\t%s /* %s */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = %s; sourceTree = "<group>"; };' % (fref, filename, filename))
    buildfile_lines.append('\t\t%s /* %s in Sources */ = {isa = PBXBuildFile; fileRef = %s /* %s */; };' % (bfile, filename, fref, filename))
    sources_files_by_target[target_key].append(bfile)
    return fref, bfile

# --- PCA host target: subgrouped sources ---
pca_subgroup_ids = []
for subgroup_name, files in PCA_SUBGROUPS:
    child_ids = []
    for f in files:
        fref, _bfile = add_source_file("PCA", f)
        child_ids.append(fref)
    grp = nid()
    children = ", ".join("%s /* %s */" % (cid, name) for cid, name in zip(child_ids, files))
    group_lines.append('\t\t%s /* %s */ = {isa = PBXGroup; children = (%s); path = %s; sourceTree = "<group>"; };' % (grp, subgroup_name, children, subgroup_name))
    pca_subgroup_ids.append((grp, subgroup_name))

# --- PCATests: flat additions ---
pcatests_new_ids = []
for f in PCATESTS_NEW_FILES:
    fref, _bfile = add_source_file("PCATests", f)
    pcatests_new_ids.append((fref, f))

# --- Extensions ---
ext_target_ids = []
ext_product_ids = []
ext_dependency_ids = []
ext_group_ids = []
ext_embed_buildfile_ids = []

for dirname, srcfile, bundlesuffix in EXTENSIONS:
    src_fref = nid()
    src_bfile = nid()
    fileref_lines.append('\t\t%s /* %s */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = %s; sourceTree = "<group>"; };' % (src_fref, srcfile, srcfile))
    buildfile_lines.append('\t\t%s /* %s in Sources */ = {isa = PBXBuildFile; fileRef = %s /* %s */; };' % (src_bfile, srcfile, src_fref, srcfile))

    plist_fref = nid()
    fileref_lines.append('\t\t%s /* Info.plist */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>"; };' % plist_fref)

    ent_fref = nid()
    ent_filename = dirname + ".entitlements"
    fileref_lines.append('\t\t%s /* %s */ = {isa = PBXFileReference; lastKnownFileType = text.plist.entitlements; path = %s; sourceTree = "<group>"; };' % (ent_fref, ent_filename, ent_filename))

    product_fref = nid()
    appex_name = dirname + ".appex"
    fileref_lines.append('\t\t%s /* %s */ = {isa = PBXFileReference; explicitFileType = "wrapper.app-extension"; includeInIndex = 0; path = %s; sourceTree = BUILT_PRODUCTS_DIR; };' % (product_fref, appex_name, appex_name))
    ext_product_ids.append((product_fref, appex_name))

    grp = nid()
    group_lines.append('\t\t%s /* %s */ = {isa = PBXGroup; children = (%s /* %s */, %s /* Info.plist */, %s /* %s */); path = %s; sourceTree = "<group>"; };' % (
        grp, dirname, src_fref, srcfile, plist_fref, ent_fref, ent_filename, dirname
    ))
    ext_group_ids.append((grp, dirname))

    sources_phase = nid()
    frameworks_phase = nid()
    resources_phase = nid()
    target_id = nid()
    debug_cfg = nid()
    release_cfg = nid()
    cfg_list = nid()

    bundle_id = "org.pca.app." + bundlesuffix
    common = (
        'CODE_SIGN_ENTITLEMENTS = %s/%s; CODE_SIGN_STYLE = Automatic; '
        'CURRENT_PROJECT_VERSION = 1; GENERATE_INFOPLIST_FILE = NO; INFOPLIST_FILE = %s/Info.plist; '
        'IPHONEOS_DEPLOYMENT_TARGET = 17.0; LD_RUNPATH_SEARCH_PATHS = "$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"; '
        'MARKETING_VERSION = 0.1.0; PRODUCT_BUNDLE_IDENTIFIER = %s; PRODUCT_NAME = "$(TARGET_NAME)"; '
        'SKIP_INSTALL = YES; SWIFT_VERSION = 5.0; TARGETED_DEVICE_FAMILY = "1,2";'
    ) % (dirname, ent_filename, dirname, bundle_id)
    ext_debug_settings = common + ' GCC_OPTIMIZATION_LEVEL = 0; SWIFT_OPTIMIZATION_LEVEL = "-Onone";'
    ext_release_settings = common + ' SWIFT_COMPILATION_MODE = wholemodule;'

    xcbuildconfig_lines.append('\t\t%s /* Debug */ = {isa = XCBuildConfiguration; buildSettings = {%s}; name = Debug; };' % (debug_cfg, ext_debug_settings))
    xcbuildconfig_lines.append('\t\t%s /* Release */ = {isa = XCBuildConfiguration; buildSettings = {%s}; name = Release; };' % (release_cfg, ext_release_settings))
    xcconfiglist_lines.append('\t\t%s /* Build configuration list for PBXNativeTarget \\"%s\\" */ = {isa = XCConfigurationList; buildConfigurations = (%s /* Debug */, %s /* Release */); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; };' % (cfg_list, dirname, debug_cfg, release_cfg))
    frameworks_phase_lines.append('\t\t%s /* Frameworks */ = {isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };' % frameworks_phase)
    resources_phase_lines.append('\t\t%s /* Resources */ = {isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };' % resources_phase)
    sources_phase_lines.append('\t\t%s /* Sources */ = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (%s /* %s in Sources */); runOnlyForDeploymentPostprocessing = 0; };' % (sources_phase, src_bfile, srcfile))
    target_lines.append(
        '\t\t%s /* %s */ = {isa = PBXNativeTarget; buildConfigurationList = %s /* Build configuration list for PBXNativeTarget \\"%s\\" */; '
        'buildPhases = (%s /* Sources */, %s /* Frameworks */, %s /* Resources */); buildRules = (); dependencies = (); '
        'name = %s; productName = %s; productReference = %s /* %s */; productType = "com.apple.product-type.app-extension"; };'
        % (target_id, dirname, cfg_list, dirname, sources_phase, frameworks_phase, resources_phase, dirname, dirname, product_fref, appex_name)
    )
    ext_target_ids.append((target_id, dirname))

    proxy_id = nid()
    dep_id = nid()
    containeritemproxy_lines.append('\t\t%s /* PBXContainerItemProxy */ = {isa = PBXContainerItemProxy; containerPortal = A10000000000000000000901 /* Project object */; proxyType = 1; remoteGlobalIDString = %s; remoteInfo = %s; };' % (proxy_id, target_id, dirname))
    targetdependency_lines.append('\t\t%s /* PBXTargetDependency */ = {isa = PBXTargetDependency; target = %s /* %s */; targetProxy = %s /* PBXContainerItemProxy */; };' % (dep_id, target_id, dirname, proxy_id))
    ext_dependency_ids.append(dep_id)

    embed_bfile = nid()
    buildfile_lines.append('\t\t%s /* %s in Embed App Extensions */ = {isa = PBXBuildFile; fileRef = %s /* %s */; settings = {ATTRIBUTES = (RemoveHeadersOnCopy, ); }; };' % (embed_bfile, appex_name, product_fref, appex_name))
    ext_embed_buildfile_ids.append((embed_bfile, appex_name))

# --- Embed App Extensions copy-files phase ---
embed_phase_id = nid()
embed_files_str = ", ".join("%s /* %s in Embed App Extensions */" % (bfid, name) for bfid, name in ext_embed_buildfile_ids)
embed_phase_line = '\t\t%s /* Embed App Extensions */ = {isa = PBXCopyFilesBuildPhase; buildActionMask = 2147483647; dstPath = ""; dstSubfolderSpec = 13; files = (%s); name = "Embed App Extensions"; runOnlyForDeploymentPostprocessing = 0; };' % (embed_phase_id, embed_files_str)

# --- Host app entitlements file ---
host_ent_fref = nid()
fileref_lines.append('\t\t%s /* PCA.entitlements */ = {isa = PBXFileReference; lastKnownFileType = text.plist.entitlements; path = PCA.entitlements; sourceTree = "<group>"; };' % host_ent_fref)

# ---------------------------------------------------------------------------
# Assemble
# ---------------------------------------------------------------------------

with open(PROJECT_PATH, "r", encoding="utf-8") as f:
    text = f.read()

def must_replace(old, new, label):
    global text
    assert old in text, "NOT FOUND: %s" % label
    text = text.replace(old, new, 1)

text = text.replace("/* End PBXBuildFile section */", "\n".join(buildfile_lines) + "\n/* End PBXBuildFile section */")
text = text.replace("/* End PBXFileReference section */", "\n".join(fileref_lines) + "\n/* End PBXFileReference section */")

pca_subgroup_children = ", ".join("%s /* %s */" % (gid, name) for gid, name in pca_subgroup_ids)
must_replace(
    'A10000000000000000000302 /* PCA */ = {isa = PBXGroup; children = (A10000000000000000000101 /* PCAApp.swift */, A10000000000000000000102 /* ContentView.swift */); path = PCA; sourceTree = "<group>"; };',
    'A10000000000000000000302 /* PCA */ = {isa = PBXGroup; children = (A10000000000000000000101 /* PCAApp.swift */, A10000000000000000000102 /* ContentView.swift */, %s); path = PCA; sourceTree = "<group>"; };' % pca_subgroup_children,
    "PCA group"
)

pcatests_children_new = ", ".join("%s /* %s */" % (fid, name) for fid, name in pcatests_new_ids)
must_replace(
    'A10000000000000000000303 /* PCATests */ = {isa = PBXGroup; children = (A10000000000000000000103 /* PCATests.swift */); path = PCATests; sourceTree = "<group>"; };',
    'A10000000000000000000303 /* PCATests */ = {isa = PBXGroup; children = (A10000000000000000000103 /* PCATests.swift */, %s); path = PCATests; sourceTree = "<group>"; };' % pcatests_children_new,
    "PCATests group"
)

products_new = ", ".join("%s /* %s */" % (pid, name) for pid, name in ext_product_ids)
must_replace(
    'A10000000000000000000304 /* Products */ = {isa = PBXGroup; children = (A10000000000000000000104 /* PCA.app */, A10000000000000000000105 /* PCATests.xctest */); name = Products; sourceTree = "<group>"; };',
    'A10000000000000000000304 /* Products */ = {isa = PBXGroup; children = (A10000000000000000000104 /* PCA.app */, A10000000000000000000105 /* PCATests.xctest */, %s); name = Products; sourceTree = "<group>"; };' % products_new,
    "Products group"
)

ext_group_refs = ", ".join("%s /* %s */" % (gid, name) for gid, name in ext_group_ids)
must_replace(
    'A10000000000000000000301 = {isa = PBXGroup; children = (A10000000000000000000302 /* PCA */, A10000000000000000000303 /* PCATests */, A10000000000000000000304 /* Products */); sourceTree = "<group>"; };',
    'A10000000000000000000301 = {isa = PBXGroup; children = (A10000000000000000000302 /* PCA */, A10000000000000000000303 /* PCATests */, %s, A10000000000000000000304 /* Products */); sourceTree = "<group>"; };' % ext_group_refs,
    "root group"
)

text = text.replace("/* End PBXGroup section */", "\n".join(group_lines) + "\n/* End PBXGroup section */")
text = text.replace("/* End PBXFrameworksBuildPhase section */", "\n".join(frameworks_phase_lines) + "\n/* End PBXFrameworksBuildPhase section */")
text = text.replace("/* End PBXResourcesBuildPhase section */", "\n".join(resources_phase_lines) + "\n/* End PBXResourcesBuildPhase section */")

pca_sources_flat_names = []
for _n, files in PCA_SUBGROUPS:
    pca_sources_flat_names.extend(files)
pca_sources_new = ", ".join("%s /* %s in Sources */" % (bid, name) for bid, name in zip(sources_files_by_target["PCA"], pca_sources_flat_names))
must_replace(
    'A10000000000000000000601 /* Sources */ = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (A10000000000000000000001 /* PCAApp.swift in Sources */, A10000000000000000000002 /* ContentView.swift in Sources */); runOnlyForDeploymentPostprocessing = 0; };',
    'A10000000000000000000601 /* Sources */ = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (A10000000000000000000001 /* PCAApp.swift in Sources */, A10000000000000000000002 /* ContentView.swift in Sources */, %s); runOnlyForDeploymentPostprocessing = 0; };' % pca_sources_new,
    "PCA Sources phase"
)

pcatests_sources_new = ", ".join("%s /* %s in Sources */" % (bid, name) for bid, name in zip(sources_files_by_target["PCATests"], PCATESTS_NEW_FILES))
must_replace(
    'A10000000000000000000602 /* Sources */ = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (A10000000000000000000003 /* PCATests.swift in Sources */); runOnlyForDeploymentPostprocessing = 0; };',
    'A10000000000000000000602 /* Sources */ = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (A10000000000000000000003 /* PCATests.swift in Sources */, %s); runOnlyForDeploymentPostprocessing = 0; };' % pcatests_sources_new,
    "PCATests Sources phase"
)

text = text.replace("/* End PBXSourcesBuildPhase section */", "\n".join(sources_phase_lines) + "\n/* End PBXSourcesBuildPhase section */")

copyfiles_section = "\n/* Begin PBXCopyFilesBuildPhase section */\n" + embed_phase_line + "\n/* End PBXCopyFilesBuildPhase section */\n"
text = text.replace("/* End PBXFrameworksBuildPhase section */\n", "/* End PBXFrameworksBuildPhase section */\n" + copyfiles_section, 1)

ext_deps_str = ", ".join("%s /* PBXTargetDependency */" % did for did in ext_dependency_ids)
must_replace(
    'A10000000000000000000401 /* PCA */ = {isa = PBXNativeTarget; buildConfigurationList = A10000000000000000000501 /* Build configuration list for PBXNativeTarget \\"PCA\\" */; buildPhases = (A10000000000000000000601 /* Sources */, A10000000000000000000201 /* Frameworks */, A10000000000000000000701 /* Resources */); buildRules = (); dependencies = (); name = PCA; productName = PCA; productReference = A10000000000000000000104 /* PCA.app */; productType = "com.apple.product-type.application"; };',
    'A10000000000000000000401 /* PCA */ = {isa = PBXNativeTarget; buildConfigurationList = A10000000000000000000501 /* Build configuration list for PBXNativeTarget \\"PCA\\" */; buildPhases = (A10000000000000000000601 /* Sources */, A10000000000000000000201 /* Frameworks */, A10000000000000000000701 /* Resources */, %s /* Embed App Extensions */); buildRules = (); dependencies = (%s); name = PCA; productName = PCA; productReference = A10000000000000000000104 /* PCA.app */; productType = "com.apple.product-type.application"; };' % (embed_phase_id, ext_deps_str),
    "PCA target"
)

text = text.replace("/* End PBXNativeTarget section */", "\n".join(target_lines) + "\n/* End PBXNativeTarget section */")

new_target_refs = ", ".join("%s /* %s */" % (tid, name) for tid, name in ext_target_ids)
must_replace(
    "targets = (A10000000000000000000401 /* PCA */, A10000000000000000000402 /* PCATests */);",
    "targets = (A10000000000000000000401 /* PCA */, A10000000000000000000402 /* PCATests */, %s);" % new_target_refs,
    "project targets list"
)

new_attrs_entries = "".join(" %s = {CreatedOnToolsVersion = 15.0;};" % tid for tid, _n in ext_target_ids)
must_replace(
    'TargetAttributes = {A10000000000000000000401 = {CreatedOnToolsVersion = 15.0;}; A10000000000000000000402 = {CreatedOnToolsVersion = 15.0; TestTargetID = A10000000000000000000401;};};',
    'TargetAttributes = {A10000000000000000000401 = {CreatedOnToolsVersion = 15.0;}; A10000000000000000000402 = {CreatedOnToolsVersion = 15.0; TestTargetID = A10000000000000000000401;};%s};' % new_attrs_entries,
    "TargetAttributes"
)

text = text.replace("/* End PBXTargetDependency section */", "\n".join(targetdependency_lines) + "\n/* End PBXTargetDependency section */")
text = text.replace("/* End PBXContainerItemProxy section */", "\n".join(containeritemproxy_lines) + "\n/* End PBXContainerItemProxy section */")

old_host_debug = 'A10000000000000000001003 /* Debug */ = {isa = XCBuildConfiguration; buildSettings = {ASSETCATALOG_COMPILER_APPICON_NAME = ""; CODE_SIGN_STYLE = Automatic; "CODE_SIGNING_ALLOWED[sdk=iphonesimulator*]" = NO; CURRENT_PROJECT_VERSION = 1; GENERATE_INFOPLIST_FILE = YES; INFOPLIST_KEY_CFBundleDisplayName = PCA; IPHONEOS_DEPLOYMENT_TARGET = 17.0; MARKETING_VERSION = 0.1.0; PRODUCT_BUNDLE_IDENTIFIER = org.pca.app; SWIFT_VERSION = 5.0; TARGETED_DEVICE_FAMILY = "1,2";}; name = Debug; };'
new_host_debug = old_host_debug.replace("CODE_SIGN_STYLE = Automatic;", "CODE_SIGN_ENTITLEMENTS = PCA/PCA.entitlements; CODE_SIGN_STYLE = Automatic;")
must_replace(old_host_debug, new_host_debug, "host Debug config")

old_host_release = 'A10000000000000000001004 /* Release */ = {isa = XCBuildConfiguration; buildSettings = {ASSETCATALOG_COMPILER_APPICON_NAME = ""; CODE_SIGN_STYLE = Automatic; "CODE_SIGNING_ALLOWED[sdk=iphonesimulator*]" = NO; CURRENT_PROJECT_VERSION = 1; GENERATE_INFOPLIST_FILE = YES; INFOPLIST_KEY_CFBundleDisplayName = PCA; IPHONEOS_DEPLOYMENT_TARGET = 17.0; MARKETING_VERSION = 0.1.0; PRODUCT_BUNDLE_IDENTIFIER = org.pca.app; SWIFT_VERSION = 5.0; TARGETED_DEVICE_FAMILY = "1,2";}; name = Release; };'
new_host_release = old_host_release.replace("CODE_SIGN_STYLE = Automatic;", "CODE_SIGN_ENTITLEMENTS = PCA/PCA.entitlements; CODE_SIGN_STYLE = Automatic;")
must_replace(old_host_release, new_host_release, "host Release config")

text = text.replace("/* End XCBuildConfiguration section */", "\n".join(xcbuildconfig_lines) + "\n/* End XCBuildConfiguration section */")
text = text.replace("/* End XCConfigurationList section */", "\n".join(xcconfiglist_lines) + "\n/* End XCConfigurationList section */")

with open(PROJECT_PATH, "w", encoding="utf-8") as f:
    f.write(text)

print("Done. Allocated %d new object IDs." % _counter)
print("PCA host sources added: %d" % len(sources_files_by_target["PCA"]))
print("PCATests sources added: %d" % len(sources_files_by_target["PCATests"]))
print("Extension targets added: %s" % [n for _t, n in ext_target_ids])
