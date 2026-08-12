package org.pca.app.runtime.schedule

import java.io.File

/** Gradle's JVM unit test working directory varies (module dir vs. project root) depending on
 * how the task is invoked; try the plausible candidates rather than hard-coding one, mirroring
 * `WellbeingContentCatalogueTest`'s `locateWellbeingModuleRoot` pattern. */
internal fun locateSharedVectorFile(relativePathFromRepoRoot: String): File? {
    val candidates = listOf(
        relativePathFromRepoRoot,
        "../$relativePathFromRepoRoot",
        "../../$relativePathFromRepoRoot",
        "../../../$relativePathFromRepoRoot",
    )
    return candidates.map { File(it) }.firstOrNull { it.isFile }
}
