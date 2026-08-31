package dev.teslacam.api

import dev.teslacam.scanner.EventScanner
import org.springframework.beans.factory.annotation.Value
import org.springframework.core.io.PathResource
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RestController
import java.nio.file.Files
import java.nio.file.Path

/**
 * Streams raw dashcam media files.
 *
 * Range handling (Accept-Ranges, 206 + Content-Range, 416 + "bytes *&#47;total") is
 * provided natively by Spring Framework 7's resource handling in
 * AbstractMessageConverterMethodProcessor: returning a [PathResource] body is all
 * that is needed. Manually returning a [org.springframework.core.io.support.ResourceRegion]
 * body does not work here because Spring 7's ResourceRegionHttpMessageConverter
 * requires the handler's declared target type to be ResourceRegion (or a
 * Collection of them), which a generic ResponseEntity body cannot express.
 */
@RestController
class MediaController(
    @Value("\${teslacam.root}") private val root: String,
) {
    companion object {
        private val CATEGORIES = EventScanner.CATEGORIES
        private val ALLOWED_FILE = Regex("""^[\w-]+\.mp4$|^thumb\.png$""")
    }

    @GetMapping("/media/{category}/{folder}/{file}")
    fun media(
        @PathVariable category: String,
        @PathVariable folder: String,
        @PathVariable file: String,
    ): ResponseEntity<PathResource> {
        if (category !in CATEGORIES || !ALLOWED_FILE.matches(file)) return notFound()
        val path = safePath(category, folder, file) ?: return notFound()
        val contentType = if (file.endsWith(".mp4")) MediaType.parseMediaType("video/mp4") else MediaType.IMAGE_PNG
        return ResponseEntity.ok()
            .contentType(contentType)
            .contentLength(Files.size(path))
            .body(PathResource(path))
    }

    private fun safePath(category: String, folder: String, file: String): Path? {
        if (folder.contains('/') || folder.contains('\\') || folder == "." || folder == "..") return null
        val rootDir = Path.of(root).toAbsolutePath().normalize()
        val target = rootDir.resolve(category).resolve(folder).resolve(file).normalize().toAbsolutePath()
        return if (!target.startsWith(rootDir) || !Files.isRegularFile(target)) null else target
    }

    private fun notFound(): ResponseEntity<PathResource> = ResponseEntity.notFound().build()
}