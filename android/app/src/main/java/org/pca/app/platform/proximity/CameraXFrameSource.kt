package org.pca.app.platform.proximity

import android.content.Context
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.os.Handler
import android.os.Looper
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import com.google.common.util.concurrent.ListenableFuture
import java.io.ByteArrayOutputStream
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

/**
 * The concrete, CameraX-backed [EphemeralCameraFrameSource] the composition root binds into
 * [CameraProximitySource] (doc 13 Section 4, Tier 2). Hard rules enforced here, mirroring
 * [EphemeralCameraFrameSource]'s and [FaceProximityEstimator]'s own doc comments:
 *  - the camera session is only ever bound while [setRunning] is currently `true` -- CameraX only
 *    starts producing frames once [ControllableLifecycleOwner] is moved to [Lifecycle.State.RESUMED],
 *    and [setRunning]`(false)` immediately unbinds and tears the session down;
 *  - [SingleSlotFrameBuffer] holds at most ONE unconsumed frame at a time -- a new analysis frame
 *    always replaces (and closes/recycles) whatever frame was not yet consumed by [nextFrame],
 *    never appending to a queue or buffer of frames;
 *  - the source [ImageProxy] handed to the analyzer callback is ALWAYS closed before that callback
 *    returns (`try`/`finally` in [onFrameAvailable]), regardless of whether conversion succeeded;
 *  - no frame, bitmap, byte array, or file is ever written to disk, `MediaStore`, cache, or any
 *    other persistent location, and nothing here opens a network/HTTP connection or socket of any
 *    kind -- see `CameraPrivacyStaticScanTest` for the source-scanning proof of both properties.
 *
 * [cameraProviderFuture] is an injection seam purely for future callers that want to substitute a
 * fake/test double for [ProcessCameraProvider.getInstance] -- it is not itself exercised by a JVM
 * unit test in this pass (binding a live camera session requires a real device/emulator camera
 * stack, out of reach for `testDebugUnitTest`); [SingleSlotFrameBuffer] and the pure
 * `convertToBitmapFrame`/`yuv420ToNv21` conversion functions below carry the actual unit-test
 * coverage for this file's frame-retention and always-close discipline.
 */
class CameraXFrameSource(
    private val context: Context,
    private val cameraSelector: CameraSelector = CameraSelector.DEFAULT_FRONT_CAMERA,
    private val cameraProviderFuture: () -> ListenableFuture<ProcessCameraProvider> =
        { ProcessCameraProvider.getInstance(context) },
) : EphemeralCameraFrameSource {

    private val mainHandler = Handler(Looper.getMainLooper())
    private val lifecycleOwner = ControllableLifecycleOwner()
    private val analysisExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private val frameBuffer = SingleSlotFrameBuffer()

    @Volatile private var boundProvider: ProcessCameraProvider? = null

    /** Camera-hardware presence only -- never claims permission is granted (that is
     * [CameraProximitySource]'s own [CameraPermissionStateSource] concern, checked upstream on
     * every call before this class is ever asked for a frame). */
    override fun isAvailable(): Boolean = runCatching {
        context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
    }.getOrDefault(false)

    /** CameraX's `bindToLifecycle`/lifecycle-state transitions must happen on the main thread;
     * [setRunning] may legitimately be called from a background coroutine (see
     * [CameraProximitySource]'s own doc comment), so the actual bind/unbind work is always
     * marshalled onto [mainHandler] regardless of the calling thread. */
    override fun setRunning(running: Boolean) {
        mainHandler.post {
            if (running) startOnMainThread() else stopOnMainThread()
        }
    }

    /** At most the single most-recently produced, not-yet-consumed frame -- see
     * [SingleSlotFrameBuffer]'s own doc comment. Consuming it here never re-triggers analysis;
     * the next frame only appears once CameraX's analyzer callback fires again. */
    override fun nextFrame(): EphemeralCameraFrame? = frameBuffer.take()

    private fun startOnMainThread() {
        if (boundProvider != null) return
        runCatching {
            val provider = cameraProviderFuture().get()
            val analysis = ImageAnalysis.Builder()
                // Deliberate: only the single latest frame is ever handed to the analyzer, never a
                // backlog -- consistent with this feature never buffering more than one frame.
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
            analysis.setAnalyzer(analysisExecutor, ::onFrameAvailable)
            provider.unbindAll()
            lifecycleOwner.moveTo(Lifecycle.State.RESUMED)
            provider.bindToLifecycle(lifecycleOwner, cameraSelector, analysis)
            boundProvider = provider
        }
    }

    private fun stopOnMainThread() {
        val provider = boundProvider
        boundProvider = null
        runCatching { provider?.unbindAll() }
        lifecycleOwner.moveTo(Lifecycle.State.CREATED)
        frameBuffer.clear()
    }

    /** The analyzer callback CameraX invokes on [analysisExecutor] for every frame while bound.
     * [imageProxy] is ALWAYS closed before returning, whether conversion succeeds, fails, or
     * throws -- no code path here can leak or retain the platform image past this single call. */
    internal fun onFrameAvailable(imageProxy: ImageProxy) {
        try {
            convertToBitmapFrame(imageProxy)?.let { frameBuffer.publish(it) }
        } finally {
            imageProxy.close()
        }
    }
}

/**
 * A minimal, real [LifecycleOwner] this class fully controls -- CameraX's `bindToLifecycle`
 * requires one, and this feature has no Activity/Fragment lifecycle of its own to bind to (the
 * composition root, not any UI screen, owns this camera session). [LifecycleRegistry.createUnsafe]
 * is used deliberately: state transitions are always marshalled onto the main thread by
 * [CameraXFrameSource] itself before calling [moveTo], so the extra main-thread assertion the
 * normal constructor performs would be redundant, not protective.
 */
private class ControllableLifecycleOwner : LifecycleOwner {
    private val registry = LifecycleRegistry.createUnsafe(this).apply {
        currentState = Lifecycle.State.CREATED
    }
    override val lifecycle: Lifecycle get() = registry
    fun moveTo(state: Lifecycle.State) {
        registry.currentState = state
    }
}

/**
 * Holds AT MOST ONE unconsumed [AndroidBitmapCameraFrame] at a time -- the concrete guarantee
 * behind PCA-FR-024's "no retained frame buffer beyond the current estimation cycle." Extracted
 * as its own class specifically so this guarantee is directly unit-testable (`SingleSlotFrameBufferTest`)
 * without any CameraX/Robolectric camera stack: every method here is pure JVM code over
 * [AndroidBitmapCameraFrame.close]'s own idempotent-recycle contract.
 */
internal class SingleSlotFrameBuffer {
    private val slot = AtomicReference<AndroidBitmapCameraFrame?>(null)

    /** Publishes [frame] as the current frame, closing (recycling) whatever unconsumed frame it
     * replaces -- a frame that is never [take]n is never left to accumulate. */
    fun publish(frame: AndroidBitmapCameraFrame) {
        slot.getAndSet(frame)?.close()
    }

    /** Consumes and returns the current frame exactly once; a second call before the next
     * [publish] returns `null` rather than re-handing out an already-consumed frame. */
    fun take(): AndroidBitmapCameraFrame? = slot.getAndSet(null)

    /** Discards and closes whatever is currently buffered (e.g. on [CameraXFrameSource.setRunning]`(false)`),
     * leaving the slot empty. */
    fun clear() {
        slot.getAndSet(null)?.close()
    }
}

/**
 * Pure, directly unit-testable conversion from one CameraX [ImageProxy] to a single
 * [AndroidBitmapCameraFrame] -- never retains [imageProxy] itself (the caller, [CameraXFrameSource.onFrameAvailable],
 * always closes it separately), never writes any intermediate byte array or bitmap to disk, and
 * never performs any network I/O. Returns `null` (rather than throwing) for any unsupported
 * format or conversion failure, matching this codebase's "never fabricate a reading" discipline --
 * [FaceProximityClassifier] already treats a missing/null geometry as UNKNOWN, not FAR.
 */
internal fun convertToBitmapFrame(imageProxy: ImageProxy): AndroidBitmapCameraFrame? = runCatching {
    if (imageProxy.format != ImageFormat.YUV_420_888 || imageProxy.planes.size < 3) return@runCatching null
    val nv21 = yuv420ToNv21(imageProxy) ?: return@runCatching null
    val yuvImage = YuvImage(nv21, ImageFormat.NV21, imageProxy.width, imageProxy.height, null)
    val out = ByteArrayOutputStream()
    if (!yuvImage.compressToJpeg(Rect(0, 0, imageProxy.width, imageProxy.height), 80, out)) return@runCatching null
    val bytes = out.toByteArray()
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.let { AndroidBitmapCameraFrame(it) }
}.getOrNull()

/**
 * Standard planar-YUV_420_888-to-NV21 repacking (handles arbitrary row/pixel stride, since CameraX
 * does not guarantee tightly-packed planes) -- an in-memory byte array only, never written
 * anywhere persistent, discarded as soon as [convertToBitmapFrame] finishes with it.
 */
internal fun yuv420ToNv21(image: ImageProxy): ByteArray? = runCatching {
    val width = image.width
    val height = image.height
    val yPlane = image.planes[0]
    val uPlane = image.planes[1]
    val vPlane = image.planes[2]
    val nv21 = ByteArray(width * height + 2 * ((width + 1) / 2) * ((height + 1) / 2))

    var pos = 0
    val yBuffer = yPlane.buffer.duplicate()
    val yRowStride = yPlane.rowStride
    for (row in 0 until height) {
        yBuffer.position(row * yRowStride)
        yBuffer.get(nv21, pos, width)
        pos += width
    }

    val uBuffer = uPlane.buffer.duplicate()
    val vBuffer = vPlane.buffer.duplicate()
    val uvRowStride = vPlane.rowStride
    val uvPixelStride = vPlane.pixelStride
    val chromaHeight = (height + 1) / 2
    val chromaWidth = (width + 1) / 2
    for (row in 0 until chromaHeight) {
        for (col in 0 until chromaWidth) {
            val index = row * uvRowStride + col * uvPixelStride
            nv21[pos++] = vBuffer.get(index)
            nv21[pos++] = uBuffer.get(index)
        }
    }
    nv21
}.getOrNull()
