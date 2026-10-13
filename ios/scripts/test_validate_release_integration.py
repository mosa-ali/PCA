import importlib.util
from pathlib import Path
import unittest


SCRIPT = Path(__file__).with_name("validate_release_integration.py")
SPEC = importlib.util.spec_from_file_location("validate_release_integration", SCRIPT)
VALIDATOR = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(VALIDATOR)


class ReleaseIntegrationValidatorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.project = VALIDATOR.PROJECT.read_text(encoding="utf-8")

    def test_current_targets_have_release_deployment_signing_and_archive_settings(self):
        VALIDATOR.validate_target_products(self.project)
        for target in VALIDATOR.TARGETS:
            configs = VALIDATOR.target_build_settings(self.project, target)
            self.assertEqual(set(configs), {"Debug", "Release"})
            self.assertEqual(configs["Release"]["IPHONEOS_DEPLOYMENT_TARGET"], "17.0")
            self.assertIn(configs["Release"]["CODE_SIGN_STYLE"], {"Automatic", "Manual"})

    def test_each_target_configuration_binds_its_own_bundle_and_entitlements(self):
        for target, (entitlements, _info, bundle_id, _extension) in VALIDATOR.TARGETS.items():
            for configuration, settings in VALIDATOR.target_build_settings(self.project, target).items():
                VALIDATOR.validate_target_identity_settings(
                    settings, target, configuration, bundle_id, entitlements
                )

    def test_target_identity_validation_rejects_mismatched_bundle_or_entitlements(self):
        base = VALIDATOR.target_build_settings(self.project, "PCA")["Release"]
        for changes in (
            {"PRODUCT_BUNDLE_IDENTIFIER": "org.pca.wrong"},
            {"CODE_SIGN_ENTITLEMENTS": "PCA/Other.entitlements"},
        ):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                VALIDATOR.validate_target_identity_settings(
                    base | changes, "PCA", "Release", "org.pca.app", "PCA/PCA.entitlements"
                )

    def test_extension_info_requires_package_identity_and_exact_runtime_principal_class(self):
        for target, (_entitlements, info_path, _bundle_id, extension_point) in VALIDATOR.TARGETS.items():
            if extension_point is None:
                continue
            info = VALIDATOR.parse_plist(VALIDATOR.ROOT / info_path)
            VALIDATOR.validate_extension_info(info, target, extension_point)
            source_path = VALIDATOR.EXTENSION_SOURCE_FILES[target]
            source = (VALIDATOR.ROOT / source_path).read_text(encoding="utf-8")
            VALIDATOR.validate_extension_source(source, target)

            wrong_principal = {
                **info,
                "NSExtension": {
                    **info["NSExtension"],
                    "NSExtensionPrincipalClass": "$(PRODUCT_MODULE_NAME).WrongExtension",
                },
            }
            with self.subTest(target=target, defect="principal class"), self.assertRaises(ValueError):
                VALIDATOR.validate_extension_info(wrong_principal, target, extension_point)

            wrong_package = {**info, "CFBundlePackageType": "APPL"}
            with self.subTest(target=target, defect="package type"), self.assertRaises(ValueError):
                VALIDATOR.validate_extension_info(wrong_package, target, extension_point)

            wrong_bundle = {**info, "CFBundleIdentifier": "org.pca.wrong"}
            with self.subTest(target=target, defect="bundle identifier"), self.assertRaises(ValueError):
                VALIDATOR.validate_extension_info(wrong_bundle, target, extension_point)

            principal_class = VALIDATOR.EXTENSION_PRINCIPAL_CLASSES[target]
            source_without_entry_point = source.replace(principal_class, "WrongExtension", 1)
            with self.subTest(target=target, defect="missing runtime class"), self.assertRaises(ValueError):
                VALIDATOR.validate_extension_source(source_without_entry_point, target)

    def test_enrollment_links_require_custom_scheme_and_universal_link_domain(self):
        entitlements = VALIDATOR.parse_plist(VALIDATOR.ROOT / VALIDATOR.TARGETS["PCA"][0])
        info = VALIDATOR.parse_plist(VALIDATOR.ROOT / VALIDATOR.TARGETS["PCA"][1])
        VALIDATOR.validate_enrollment_link_configuration(entitlements, info)

        wrong_scheme = {
            **info,
            "CFBundleURLTypes": [{
                "CFBundleURLName": "org.pca.app.enrollment",
                "CFBundleURLSchemes": ["other"],
            }],
        }
        with self.assertRaises(ValueError):
            VALIDATOR.validate_enrollment_link_configuration(entitlements, wrong_scheme)

        missing_domain = {
            key: value for key, value in entitlements.items()
            if key != "com.apple.developer.associated-domains"
        }
        with self.assertRaises(ValueError):
            VALIDATOR.validate_enrollment_link_configuration(missing_domain, info)

    def test_enrollment_parser_and_app_url_delivery_match_release_link_configuration(self):
        parser_source = (VALIDATOR.ROOT / "PCA/Enrollment/ChildEnrollmentCoordinator.swift").read_text(encoding="utf-8")
        app_source = (VALIDATOR.ROOT / "PCA/PCAApp.swift").read_text(encoding="utf-8")
        VALIDATOR.validate_enrollment_link_source(parser_source, app_source)

        with self.assertRaises(ValueError):
            VALIDATOR.validate_enrollment_link_source(
                parser_source.replace('universalLinkHost = "www.pcasafe.com"', 'universalLinkHost = "other.example"'),
                app_source,
            )
        with self.assertRaises(ValueError):
            VALIDATOR.validate_enrollment_link_source(
                parser_source,
                app_source.replace("application.receiveEnrollmentLink(url)", "application.ignoreURL(url)"),
            )

    def test_release_rejects_signing_disabled_or_ad_hoc_local_signing(self):
        base = {
            "IPHONEOS_DEPLOYMENT_TARGET": "17.0",
            "CODE_SIGN_STYLE": "Automatic",
        }
        for changes in (
            {"CODE_SIGNING_ALLOWED": "NO"},
            {"CODE_SIGNING_ALLOWED[sdk=iphoneos*]": "NO"},
            {"CODE_SIGNING_REQUIRED": "NO"},
            {"CODE_SIGN_IDENTITY": "-"},
        ):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                VALIDATOR.validate_build_settings(base | changes, "PCA", "Release")

    def test_simulator_only_no_signing_override_is_not_misclassified_as_release_only(self):
        settings = {
            "IPHONEOS_DEPLOYMENT_TARGET": "17.0",
            "CODE_SIGN_STYLE": "Automatic",
            "CODE_SIGNING_ALLOWED[sdk=iphonesimulator*]": "NO",
        }
        VALIDATOR.validate_build_settings(settings, "PCA", "Release")

    def test_release_rejects_wrong_deployment_and_debug_only_build_settings(self):
        base = {
            "IPHONEOS_DEPLOYMENT_TARGET": "17.0",
            "CODE_SIGN_STYLE": "Automatic",
        }
        for changes in (
            {"IPHONEOS_DEPLOYMENT_TARGET": "16.0"},
            {"IPHONEOS_DEPLOYMENT_TARGET[sdk=iphoneos*]": "16.0"},
            {"ONLY_ACTIVE_ARCH": "YES"},
            {"SWIFT_OPTIMIZATION_LEVEL": "-Onone"},
            {"GCC_OPTIMIZATION_LEVEL": "0"},
            {"ENABLE_TESTABILITY": "YES"},
        ):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                VALIDATOR.validate_build_settings(base | changes, "PCA", "Release")


if __name__ == "__main__":
    unittest.main()
