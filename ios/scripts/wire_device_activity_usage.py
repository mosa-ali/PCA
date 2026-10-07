"""Wire shared usage attribution with stable IDs, without renumbering the project."""
from pathlib import Path
import re

IDS = [f"D2000000000000000000000{i}" for i in range(1, 6)]

def validate(text):
    definitions = re.findall(r"(?m)^\s*([A-F0-9]{24})(?: /\*.*?\*/)? = \{", text)
    if len(definitions) != len(set(definitions)):
        raise ValueError("Duplicate project objects")
    for identifier in IDS:
        if definitions.count(identifier) != 1:
            raise ValueError("Incomplete usage wiring: " + identifier)
    for owner, member in bindings():
        line = re.search(r"(?m)^\s*" + owner + r"[^\n]*", text)
        if not line or line.group(0).count(member) != 1:
            raise ValueError("Incorrect usage target/group binding: " + owner)
    for identifier, filename in [(IDS[0], "DeviceActivityUsageAttribution.swift"),
                                 (IDS[3], "DeviceActivityUsageAttributionTests.swift")]:
        line = re.search(r"(?m)^\s*" + identifier + r"[^\n]*", text)
        if not line or "isa = PBXFileReference;" not in line.group(0) or "path = " + filename + ";" not in line.group(0):
            raise ValueError("Incorrect usage source file reference: " + identifier)

def bindings():
    source, host, monitor, test, test_build = IDS
    return [(host, source), (monitor, source), (test_build, test),
        ("B1000000000000000000000A", source), ("A10000000000000000000303", test),
        ("A10000000000000000000601", host), ("B1000000000000000000005C", monitor),
        ("A10000000000000000000602", test_build)]

def wire_project(project_path="PCA.xcodeproj/project.pbxproj"):
    path = Path(project_path)
    text = path.read_text(encoding="utf-8")
    if any(identifier in text for identifier in IDS):
        validate(text)
        return
    source, host, monitor, test, test_build = IDS
    def section(marker, lines):
        nonlocal text
        if text.count(marker) != 1:
            raise ValueError("Missing project section: " + marker)
        text = text.replace(marker, "\n".join(lines) + "\n" + marker, 1)
    section("/* End PBXFileReference section */", [
        f'\t\t{source} = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = DeviceActivityUsageAttribution.swift; sourceTree = "<group>"; }};',
        f'\t\t{test} = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = DeviceActivityUsageAttributionTests.swift; sourceTree = "<group>"; }};',
    ])
    section("/* End PBXBuildFile section */", [
        f'\t\t{build} = {{isa = PBXBuildFile; fileRef = {ref}; }};'
        for build, ref in [(host, source), (monitor, source), (test_build, test)]
    ])
    for owner, member in bindings()[3:]:
        field = "children" if owner in ["B1000000000000000000000A", "A10000000000000000000303"] else "files"
        pattern = r"(?m)^(\s*" + owner + r"[^\n]*?" + field + r" = \()"
        text, count = re.subn(pattern, lambda match: match.group(1) + member + ", ", text)
        if count != 1:
            raise ValueError("Missing usage target/group: " + owner)
    validate(text)
    path.write_text(text, encoding="utf-8")

if __name__ == "__main__":
    wire_project()
