package dev.teslacam.api

import dev.teslacam.encrypt.EcryptfsHeader
import dev.teslacam.encrypt.EncryptedMediaService
import dev.teslacam.encrypt.EncryptionDetector
import dev.teslacam.encrypt.TeslaKeyStore
import dev.teslacam.scanner.EventScanner
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.beans.factory.annotation.Value
import org.springframework.core.io.PathResource
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RestController
import java.nio.file.Files
import java.nio.file.NoSuchFileException
import java.nio.file.Path

/**
 * Streams raw dashcam media files.
 *
 * Plain files are served as [PathResource]: Range handling (Accept-Ranges,
 * 206 + Content-Range, 416 + "bytes *&#47;total") is provided natively by
 * Spring Framework 7's resource handling in AbstractMessageConverterMethodProcessor.
 * Manually returning a [org.springframework.core.io.support.ResourceRegion]
 * body does not work here because Spring 7's ResourceRegionHttpMessageConverter
 * requires the handler's declared target type to be ResourceRegion (or a
 * Collection of them), which a generic ResponseEntity body cannot express.
 *
 * eCryptfs-encrypted clips (detected via [EncryptionDetector]) are decrypted
 * transparently and written straight to the servlet response with manual Range
 * support (single byte range only; malformed/multiple ranges fall back to a
 * full 200 as RFC 9110 permits). A [org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody]
 * body cannot be used here: inside a ResponseEntity whose Kotlin-erased generic
 * is a star projection, Spring 7's StreamingResponseBodyReturnValueHandler does
 * not claim the value and the body falls through to message conversion, which
 * fails with "No converter for ... $$Lambda".
 */
@RestController
class MediaController(
    @Value("\${teslacam.root}") private val root: String,
    private val detector: EncryptionDetector,
    private val keyStore: TeslaKeyStore,
    private val encryptedMedia: EncryptedMediaService,
) {
    companion object {
        private val CATEGORIES = EventScanner.CATEGORIES
        private val ALLOWED_FILE = Regex("""^[\w-]+\.mp4$|^thumb\.png$""")
        private val RANGE = Regex("""^bytes=(\d*)-(\d*)$""")
        private const val MISSING_KEY_BODY = """{"error":"missing_key"}"""
        private const val RANGE_NOT_SATISFIABLE_BODY = """{"error":"range_not_satisfiable"}"""
    }

    @GetMapping("/media/{category}/{folder}/{file}")
    fun media(
        @PathVariable category: String,
        @PathVariable folder: String,
        @PathVariable file: String,
        request: HttpServletRequest,
        response: HttpServletResponse,
    ): ResponseEntity<*>? {
        if (category !in CATEGORIES || !ALLOWED_FILE.matches(file)) return notFound()
        val path = safePath(category, folder, file) ?: return notFound()
        val contentType = if (file.endsWith(".mp4")) MediaType.parseMediaType("video/mp4") else MediaType.IMAGE_PNG
        // TOCTOU with RecentClips rotation: the file may vanish between the
        // safePath existence check and headerFor()'s stat calls, which throw
        // NoSuchFileException. Gone is gone — 404, not a 500. (A null return
        // is a valid *plain* file and must fall through to plain serving.)
        val header = try {
            detector.headerFor(path)
        } catch (_: NoSuchFileException) {
            return notFound()
        }
        return if (header == null) plain(path, contentType)
        else {
            encrypted(path, header, contentType, request, response)
            null // response fully written by encrypted(); nothing left for the message converters
        }
    }

    /** Existing plain-file serving, unchanged. */
    private fun plain(path: Path, contentType: MediaType): ResponseEntity<PathResource> =
        ResponseEntity.ok()
            .contentType(contentType)
            .contentLength(Files.size(path))
            .body(PathResource(path))

    /** Writes a decrypted slice of an eCryptfs clip directly to the servlet response. */
    private fun encrypted(
        path: Path,
        header: EcryptfsHeader,
        contentType: MediaType,
        request: HttpServletRequest,
        response: HttpServletResponse,
    ) {
        val fek = try {
            encryptedMedia.requireFek(header)
        } catch (_: EncryptedMediaService.MissingKeyException) {
            response.status = 409
            response.contentType = "application/json"
            response.outputStream.write(MISSING_KEY_BODY.toByteArray())
            return
        }
        val size = header.plaintextSize
        val rangeHeader = request.getHeader("Range")?.trim()
        if (rangeHeader.isNullOrEmpty()) {
            writeDecrypted(response, path, header, fek, contentType, 0, size - 1, 200, null)
            return
        }
        val m = RANGE.matchEntire(rangeHeader)
        // Multiple ranges or malformed → serve full 200 (RFC allows ignoring Range).
        if (m == null || (m.groupValues[1].isEmpty() && m.groupValues[2].isEmpty())) {
            writeDecrypted(response, path, header, fek, contentType, 0, size - 1, 200, null)
            return
        }
        val (start, end) = if (m.groupValues[1].isEmpty()) {
            // suffix "-N": last N bytes
            val n = m.groupValues[2].toLong().coerceAtLeast(1)
            (size - n).coerceAtLeast(0) to (size - 1)
        } else {
            val s = m.groupValues[1].toLong()
            val e = if (m.groupValues[2].isEmpty()) size - 1 else m.groupValues[2].toLong().coerceAtMost(size - 1)
            s to e
        }
        if (start >= size || start > end) {
            response.status = 416
            response.setHeader("Content-Range", "bytes */$size")
            response.contentType = "application/json"
            response.outputStream.write(RANGE_NOT_SATISFIABLE_BODY.toByteArray())
            return
        }
        writeDecrypted(response, path, header, fek, contentType, start, end, 206, "bytes $start-$end/$size")
    }

    private fun writeDecrypted(
        response: HttpServletResponse,
        path: Path,
        header: EcryptfsHeader,
        fek: ByteArray,
        contentType: MediaType,
        start: Long,
        end: Long,
        status: Int,
        contentRange: String?,
    ) {
        response.status = status
        response.contentType = contentType.toString()
        response.setHeader("Accept-Ranges", "bytes")
        if (contentRange != null) response.setHeader("Content-Range", contentRange)
        response.setContentLengthLong(end - start + 1)
        encryptedMedia.writeRange(path, header, fek, start, end, response.outputStream)
        response.outputStream.flush()
    }

    private fun safePath(category: String, folder: String, file: String): Path? {
        if (folder.contains('/') || folder.contains('\\') || folder == "." || folder == "..") return null
        val rootDir = Path.of(root).toAbsolutePath().normalize()
        val target = rootDir.resolve(category).resolve(folder).resolve(file).normalize().toAbsolutePath()
        return if (!target.startsWith(rootDir) || !Files.isRegularFile(target)) null else target
    }

    private fun notFound(): ResponseEntity<PathResource> = ResponseEntity.notFound().build()
}