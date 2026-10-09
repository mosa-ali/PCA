from pathlib import Path
import re

FILES = [('01','02','OrdinaryTrustSetCoordinator.swift','D10000000000000000000005','A10000000000000000000601'),('03','04','OrdinaryTrustSetAPIClient.swift','D10000000000000000000005','A10000000000000000000601'),('05','06','OrdinaryTrustSetCoordinatorTests.swift','A10000000000000000000303','A10000000000000000000602')]

def wire_project(project_path='PCA.xcodeproj/project.pbxproj'):
    path=Path(project_path)
    text=path.read_text(encoding='utf-8')
    for a,b,name,group,phase in FILES:
        ref='D300000000000000000000'+a
        build='D300000000000000000000'+b
        if ref in text or build in text:
            if not (ref in text and build in text): raise ValueError('Partial ordinary epoch wiring')
            for identifier,member in [(group,ref),(phase,build)]:
                line=re.search(r'(?m)^\s*'+identifier+r'[^\n]*',text)
                if not line or member not in line.group(0): raise ValueError('Wrong ordinary epoch target')
            continue
        for marker,line in [('/* End PBXFileReference section */',f'\t\t{ref} /* {name} */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {name}; sourceTree = "<group>"; }};'),('/* End PBXBuildFile section */',f'\t\t{build} /* {name} in Sources */ = {{isa = PBXBuildFile; fileRef = {ref} /* {name} */; }};')]:
            if text.count(marker)!=1: raise ValueError('Invalid project section')
            text=text.replace(marker,line+'\n'+marker,1)
        for identifier,member,listname in [(group,ref,'children'),(phase,build,'files')]:
            text,count=re.subn(r'(?m)^(\s*'+identifier+r'[^\n]*?'+listname+r' = \()',lambda m:m.group(1)+member+', ',text)
            if count!=1: raise ValueError('Missing ordinary epoch target')
    definitions=re.findall(r'(?m)^\s*([A-F0-9]{24})(?: /\*.*?\*/)? = \{',text)
    if len(definitions)!=len(set(definitions)): raise ValueError('Duplicate project object')
    path.write_text(text,encoding='utf-8')

if __name__=='__main__': wire_project()
