#!/usr/bin/env python3
"""Static checks for PCA's iOS app/extension release wiring.

This validates repository declarations only. It does not verify Apple portal
capability approval, provisioning profiles, signing, or device behavior.
"""

from pathlib import Path
import plistlib
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / "PCA.xcodeproj" / "project.pbxproj"
APP_GROUP = "group.org.pca.app"
ENROLLMENT_URL_SCHEME = "pca"
ENROLLMENT_ASSOCIATED_DOMAIN = "applinks:www.pcasafe.com"
ENROLLMENT_UNIVERSAL_HOST = "www.pcasafe.com"
ENROLLMENT_UNIVERSAL_PATH = "/enroll/"
MINIMUM_IOS_DEPLOYMENT_TARGET = "17.0"
TARGETS = {
    "PCA": ("PCA/PCA.entitlements", "PCA/Info.plist", "org.pca.app", None),
    "PCADeviceActivityMonitor": (
        "PCADeviceActivityMonitor/PCADeviceActivityMonitor.entitlements",
        "PCADeviceActivityMonitor/Info.plist",
        "org.pca.app.deviceactivitymonitor",
        "com.apple.deviceactivity.monitor-extension",
    ),
    "PCAShieldConfiguration": (
        "PCAShieldConfiguration/PCAShieldConfiguration.entitlements",
        "PCAShieldConfiguration/Info.plist",
        "org.pca.app.shieldconfiguration",
        "com.apple.ManagedSettingsUI.shield-configuration-service",
    ),
    "PCAShieldAction": (
        "PCAShieldAction/PCAShieldAction.entitlements",
        "PCAShieldAction/Info.plist",
        "org.pca.app.shieldaction",
        "com.apple.ManagedSettings.shield-action-service",
    ),
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def parse_plist(path: Path) -> dict:
    with path.open("rb") as stream:
        value = plistlib.load(stream)
    require(isinstance(value, dict), f"{path.relative_to(ROOT)} is not a plist dictionary")
    return value


def named_object(project: str, name: str, kind: str) -> str:
    match = re.search(
        rf"\b([A-F0-9]{{24}}) /\* {re.escape(name)} \*/ = \{{isa = {kind};.*?\}};",
        project,
    )
    require(match is not None, f"Xcode project has no {kind} object named {name}")
    return match.group(0)


def source_phase(project: str, target: str) -> str:
    target_object = named_object(project, target, "PBXNativeTarget")
    phases = re.search(r"buildPhases = \((.*?)\);", target_object)
    require(phases is not None, f"{target} has no build phases")
    phase_id = re.search(r"([A-F0-9]{24}) /\* Sources \*/", phases.group(1))
    require(phase_id is not None, f"{target} has no Sources phase")
    phase = re.search(
        rf"{phase_id.group(1)} /\* Sources \*/ = \{{isa = PBXSourcesBuildPhase;.*?files = \((.*?)\);",
        project,
    )
    require(phase is not None, f"{target} Sources phase is malformed")
    return phase.group(1)


def target_build_settings(project: str, target: str) -> dict[str, dict[str, str]]:
    """Read the target's Debug/Release settings from the PBX project declarations."""
    target_object = named_object(project, target, "PBXNativeTarget")
    config_list = re.search(r"buildConfigurationList = ([A-F0-9]{24}) /\* Build configuration list", target_object)
    require(config_list is not None, f"{target} has no build configuration list")
    list_id = config_list.group(1)
    list_match = re.search(
        rf"{list_id} /\* Build configuration list[^*]*\*/ = \{{isa = XCConfigurationList; buildConfigurations = \((.*?)\);",
        project,
    )
    require(list_match is not None, f"{target} build configuration list is malformed")
    configurations: dict[str, dict[str, str]] = {}
    for config_id, name in re.findall(r"([A-F0-9]{24}) /\* (Debug|Release) \*/", list_match.group(1)):
        config = re.search(
            rf"{config_id} /\* {name} \*/ = \{{isa = XCBuildConfiguration; buildSettings = \{{(.*?)\}}; name = {name}; \}};",
            project,
        )
        require(config is not None, f"{target} {name} build settings are malformed")
        settings: dict[str, str] = {}
        for key, raw_value in re.findall(r"([A-Za-z0-9_]+(?:\[[^]]+\])?) = (\"[^\"]*\"|[^;]+);", config.group(1)):
            value = raw_value.strip()
            settings[key] = value[1:-1] if value.startswith('\"') and value.endswith('\"') else value
        configurations[name] = settings
    require(set(configurations) == {"Debug", "Release"},
            f"{target} must declare exactly one Debug and one Release configuration")
    return configurations


def validate_target_identity_settings(
    settings: dict[str, str], target: str, configuration: str,
    bundle_id: str, entitlement_path: str,
) -> None:
    require(settings.get("PRODUCT_BUNDLE_IDENTIFIER") == bundle_id,
            f"{target} {configuration} must use bundle id {bundle_id}")
    require(settings.get("CODE_SIGN_ENTITLEMENTS") == entitlement_path,
            f"{target} {configuration} must use entitlements {entitlement_path}")


def validate_enrollment_link_configuration(entitlements: dict, info: dict) -> None:
    """Keep release URL registration aligned with the implemented invite router."""
    domains = entitlements.get("com.apple.developer.associated-domains")
    require(isinstance(domains, list) and ENROLLMENT_ASSOCIATED_DOMAIN in domains,
            f"PCA is missing associated domain {ENROLLMENT_ASSOCIATED_DOMAIN}")

    url_types = info.get("CFBundleURLTypes")
    require(isinstance(url_types, list), "PCA is missing its custom enrollment URL type")
    registered_schemes = {
        scheme
        for url_type in url_types
        if isinstance(url_type, dict)
        and url_type.get("CFBundleURLName") == "org.pca.app.enrollment"
        for scheme in url_type.get("CFBundleURLSchemes", [])
        if isinstance(scheme, str)
    }
    require(ENROLLMENT_URL_SCHEME in registered_schemes,
            f"PCA is missing the {ENROLLMENT_URL_SCHEME} enrollment URL scheme")


def validate_enrollment_link_source(parser_source: str, app_source: str) -> None:
    """Keep the parser's canonical URL and the SwiftUI delivery hook aligned with release config."""
    require(
        f'universalLinkHost = "{ENROLLMENT_UNIVERSAL_HOST}"' in parser_source,
        "enrollment parser host does not match the associated domain",
    )
    require(
        f'universalLinkPath = "{ENROLLMENT_UNIVERSAL_PATH}"' in parser_source,
        "enrollment parser path does not match the supported invite path",
    )
    require(
        ".onOpenURL { url in _ = application.receiveEnrollmentLink(url) }" in app_source,
        "PCAApp does not forward incoming URLs to the enrollment handler",
    )


def validate_build_settings(settings: dict[str, str], target: str, configuration: str) -> None:
    deployment = settings.get("IPHONEOS_DEPLOYMENT_TARGET")
    require(deployment == MINIMUM_IOS_DEPLOYMENT_TARGET,
            f"{target} {configuration} must target iOS {MINIMUM_IOS_DEPLOYMENT_TARGET}")
    require(all(value == MINIMUM_IOS_DEPLOYMENT_TARGET
                for key, value in settings.items()
                if key.startswith("IPHONEOS_DEPLOYMENT_TARGET[")),
            f"{target} {configuration} has a conditional deployment-target override")
    if configuration != "Release":
        return

    require(settings.get("CODE_SIGN_STYLE") in {"Automatic", "Manual"},
            f"{target} Release must declare an Xcode signing style")
    require(settings.get("CODE_SIGNING_ALLOWED", "YES") != "NO",
            f"{target} Release disables code signing")
    for key, value in settings.items():
        if key.startswith("CODE_SIGNING_ALLOWED[") and value == "NO":
            require("iphonesimulator" in key.lower(),
                    f"{target} Release disables signing outside the simulator SDK")
    require(settings.get("CODE_SIGNING_REQUIRED", "YES") != "NO",
            f"{target} Release marks code signing optional")
    require(settings.get("CODE_SIGN_IDENTITY") != "-",
            f"{target} Release uses ad-hoc/local-only signing")
    require(settings.get("ONLY_ACTIVE_ARCH") != "YES",
            f"{target} Release is limited to the active local architecture")
    require(settings.get("SWIFT_OPTIMIZATION_LEVEL") != "-Onone" and
            settings.get("GCC_OPTIMIZATION_LEVEL") != "0" and
            settings.get("ENABLE_TESTABILITY") != "YES",
            f"{target} Release contains Debug/local-only build settings")


def validate_target_products(project: str) -> None:
    for target in TARGETS:
        target_object = named_object(project, target, "PBXNativeTarget")
        product_type = re.search(r'productType = "([^"]+)";', target_object)
        expected = "com.apple.product-type.application" if target == "PCA" else "com.apple.product-type.app-extension"
        require(product_type is not None and product_type.group(1) == expected,
                f"{target} must be an {expected} product")
        configurations = target_build_settings(project, target)
        for name, settings in configurations.items():
            validate_build_settings(settings, target, name)
            if target == "PCA":
                require(settings.get("SKIP_INSTALL") != "YES",
                        f"PCA {name} must remain installable for archive/export")
            else:
                require(settings.get("APPLICATION_EXTENSION_API_ONLY") == "YES",
                        f"{target} {name} must be restricted to extension-safe APIs")
                if name == "Release":
                    require(settings.get("SKIP_INSTALL") == "YES",
                            f"{target} Release must be embedded as an app extension, not archived as a standalone app")


def main() -> int:
    project = PROJECT.read_text(encoding="utf-8")
    validate_target_products(project)

    for target, (entitlement_path, info_path, bundle_id, extension_point) in TARGETS.items():
        entitlements = parse_plist(ROOT / entitlement_path)
        info = parse_plist(ROOT / info_path)
        require(entitlements.get("com.apple.developer.family-controls") is True,
                f"{target} is missing the Family Controls entitlement")
        require(entitlements.get("com.apple.security.application-groups") == [APP_GROUP],
                f"{target} must share exactly {APP_GROUP}")

        for configuration, settings in target_build_settings(project, target).items():
            validate_target_identity_settings(
                settings, target, configuration, bundle_id, entitlement_path
            )
        require((ROOT / info_path).is_file(), f"{target} Info.plist is missing")
        if extension_point is not None:
            extension = info.get("NSExtension", {})
            require(extension.get("NSExtensionPointIdentifier") == extension_point,
                    f"{target} has the wrong extension point")
            require(bool(extension.get("NSExtensionPrincipalClass")),
                    f"{target} has no extension principal class")

    validate_enrollment_link_configuration(
        parse_plist(ROOT / TARGETS["PCA"][0]),
        parse_plist(ROOT / TARGETS["PCA"][1]),
    )
    validate_enrollment_link_source(
        (ROOT / "PCA/Enrollment/ChildEnrollmentCoordinator.swift").read_text(encoding="utf-8"),
        (ROOT / "PCA/PCAApp.swift").read_text(encoding="utf-8"),
    )

    # The app must embed all three Screen Time extensions in its PlugIns
    # directory. Their source files must be compiled by their own targets.
    embed_match = re.search(
        r"\w+ /\* Embed App Extensions \*/ = \{isa = PBXCopyFilesBuildPhase;[^}]*files = \((.*?)\);",
        project,
    )
    require(embed_match is not None, "PCA has no Embed App Extensions build phase")
    embed_text = embed_match.group(1)
    for product in ("PCADeviceActivityMonitor.appex", "PCAShieldConfiguration.appex", "PCAShieldAction.appex"):
        require(product in embed_text, f"PCA does not embed {product}")

    for source in (
        ("PCADeviceActivityMonitor", "DeviceActivityMonitorExtension.swift"),
        ("PCAShieldConfiguration", "ShieldConfigurationExtension.swift"),
        ("PCAShieldAction", "ShieldActionExtension.swift"),
        ("PCA", "IosAppAttestAdapter.swift"),
    ):
        target, filename = source
        require(filename in source_phase(project, target),
                f"{filename} is not compiled by its owning target {target}")
    require("DCAppAttestService.shared" in (ROOT / "PCA/Application/PCAApplication.swift").read_text(encoding="utf-8"),
            "production composition does not resolve DCAppAttestService")

    app_target = named_object(project, "PCA", "PBXNativeTarget")
    for extension_target in ("PCADeviceActivityMonitor", "PCAShieldConfiguration", "PCAShieldAction"):
        extension_object = named_object(project, extension_target, "PBXNativeTarget")
        extension_id = re.match(r"([A-F0-9]{24})", extension_object).group(1)
        dependency = re.search(
            rf"([A-F0-9]{{24}}) /\* PBXTargetDependency \*/ = \{{isa = PBXTargetDependency; target = {extension_id} /\* {re.escape(extension_target)} \*/;",
            project,
        )
        require(dependency is not None and dependency.group(1) in app_target,
                f"PCA does not build {extension_target} as a target dependency")

    print("iOS release integration declarations: PASS")
    print("Targets: PCA + 3 embedded extensions; shared App Group and Family Controls entitlements aligned")
    print("Apple portal approval, provisioning, code signing, and physical-device capability remain external evidence")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, plistlib.InvalidFileException) as error:
        print(f"iOS release integration declarations: FAIL: {error}", file=sys.stderr)
        raise SystemExit(1)
