#!/usr/bin/env python3
"""Wire the untrusted Trust Set codec/test without renumbering existing project objects.

Called by generate_pbxproj.py after base generation, or once on an existing project.
The codec is a host structural primitive; no extension or runtime authority caller is added.
"""
from pathlib import Path
import re

CODEC_REF = "D10000000000000000000001"
CODEC_BUILD = "D10000000000000000000002"
TEST_REF = "D10000000000000000000003"
TEST_BUILD = "D10000000000000000000004"
CODEC_GROUP = "D10000000000000000000005"


def wire_project(project_path="PCA.xcodeproj/project.pbxproj"):
    path = Path(project_path)
    text = path.read_text(encoding="utf-8")
    identifiers = [CODEC_REF, CODEC_BUILD, TEST_REF, TEST_BUILD, CODEC_GROUP]
    existing = [identifier for identifier in identifiers if identifier in text]
    if existing:
        if len(existing) != len(identifiers):
            raise ValueError("Partial Trust Set project wiring; refusing to conceal an incomplete graph.")
        validate_wiring(text)
        print("Trust Set codec/test already wired; project unchanged.")
        return

    def section(marker, lines):
        nonlocal text
        if text.count(marker) != 1:
            raise ValueError("Expected one project section: " + marker)
        text = text.replace(marker, "\n".join(lines) + "\n" + marker, 1)

    section("/* End PBXBuildFile section */", [
        '\t\t%s /* FamilyTrustSetCodec.swift in Sources */ = {isa = PBXBuildFile; fileRef = %s /* FamilyTrustSetCodec.swift */; };' % (CODEC_BUILD, CODEC_REF),
        '\t\t%s /* FamilyTrustSetCodecTests.swift in Sources */ = {isa = PBXBuildFile; fileRef = %s /* FamilyTrustSetCodecTests.swift */; };' % (TEST_BUILD, TEST_REF),
    ])
    section("/* End PBXFileReference section */", [
        '\t\t%s /* FamilyTrustSetCodec.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = FamilyTrustSetCodec.swift; sourceTree = "<group>"; };' % CODEC_REF,
        '\t\t%s /* FamilyTrustSetCodecTests.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = FamilyTrustSetCodecTests.swift; sourceTree = "<group>"; };' % TEST_REF,
    ])
    section("/* End PBXGroup section */", [
        '\t\t%s /* TrustSet */ = {isa = PBXGroup; children = (%s /* FamilyTrustSetCodec.swift */); path = TrustSet; sourceTree = "<group>"; };' % (CODEC_GROUP, CODEC_REF),
    ])

    def prepend(identifier, member, list_name):
        nonlocal text
        pattern = r"(?m)^(\s*" + identifier + r"[^\n]*?" + list_name + r" = \()"
        text, count = re.subn(pattern, lambda match: match.group(1) + member + ", ", text)
        if count != 1:
            raise ValueError("Expected one target/group list: " + identifier)

    # Prepend to preserve old tail-sensitive generator/wiring script contracts.
    prepend("A10000000000000000000302", CODEC_GROUP + " /* TrustSet */", "children")
    prepend("A10000000000000000000303", TEST_REF + " /* FamilyTrustSetCodecTests.swift */", "children")
    prepend("A10000000000000000000601", CODEC_BUILD + " /* FamilyTrustSetCodec.swift in Sources */", "files")
    prepend("A10000000000000000000602", TEST_BUILD + " /* FamilyTrustSetCodecTests.swift in Sources */", "files")
    validate_wiring(text)
    path.write_text(text, encoding="utf-8")
    print("Trust Set codec and XCTest wired to host/test targets.")


def validate_wiring(text):
    definitions = re.findall(r"(?m)^\s*([A-F0-9]{24})(?: /\*.*?\*/)? = \{", text)
    if len(definitions) != len(set(definitions)):
        raise ValueError("Duplicate project object definitions.")
    for identifier in [CODEC_REF, CODEC_BUILD, TEST_REF, TEST_BUILD, CODEC_GROUP]:
        if definitions.count(identifier) != 1:
            raise ValueError("Missing or duplicate Trust Set object: " + identifier)
    for identifier, expected in [
        ("A10000000000000000000302", CODEC_GROUP),
        ("A10000000000000000000303", TEST_REF),
        ("A10000000000000000000601", CODEC_BUILD),
        ("A10000000000000000000602", TEST_BUILD),
        (CODEC_GROUP, CODEC_REF), (CODEC_BUILD, CODEC_REF), (TEST_BUILD, TEST_REF),
    ]:
        line = re.search(r"(?m)^\s*" + identifier + r"[^\n]*", text)
        if not line or expected not in line.group(0):
            raise ValueError("Trust Set reference has the wrong target/group binding: " + identifier)


if __name__ == "__main__":
    wire_project()
